"""
Browser-channel platform adapter for Hermes Agent.

Pair with the hermes-browser-channel Chrome extension. The extension
opens a WebSocket to this adapter and exchanges:

  - hello       (extension → here)
  - user_message + optional page_context (extension → here)  → MessageEvent
  - assistant_message[_start|_delta|_end]  (here → extension) ← adapter.send()
  - tool_call / tool_result  (bidirectional; agent can ask the browser
    to open URLs, capture screenshots, fill inputs, etc.)
  - ping / pong  (keepalive)

Binds 127.0.0.1:18790 by default — use an SSH tunnel from the user's
laptop, or put a TLS-terminating reverse proxy in front of it.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlsplit

from gateway.platforms.base import (
    BasePlatformAdapter,
    SendResult,
    MessageEvent,
    MessageType,
)
from gateway.config import Platform

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "1"


def _now_ms() -> int:
    return int(time.time() * 1000)


class BrowserAdapter(BasePlatformAdapter):
    """Browser-as-channel adapter, parallel to weixin/telegram adapters."""

    @property
    def name(self) -> str:
        return "Browser"

    def __init__(self, config, **_kwargs):
        platform = Platform("browser")
        super().__init__(config=config, platform=platform)

        extra = getattr(config, "extra", {}) or {}
        self.bind_host = os.getenv("BROWSER_BIND_HOST") or extra.get("bind_host", "127.0.0.1")
        try:
            self.bind_port = int(os.getenv("BROWSER_BIND_PORT") or extra.get("bind_port", 18790))
        except (TypeError, ValueError):
            self.bind_port = 18790
        self.ws_path = os.getenv("BROWSER_WS_PATH") or extra.get("ws_path", "/ws/browser")
        self.link_token = os.getenv("BROWSER_LINK_TOKEN") or extra.get("link_token", "")
        self.home_client_id = os.getenv("BROWSER_HOME_CHANNEL") or extra.get("home_client_id", "")

        self._server: Optional[Any] = None
        self._server_task: Optional[asyncio.Task] = None
        self._connections: Dict[str, "Connection"] = {}  # chat_id -> Connection
        self._pending_tools: Dict[str, asyncio.Future] = {}
        # Map from in-flight assistant message_id (set by Hermes' streaming
        # consumer via reply_to in adapter.send) → connection.
        # For now we just send full assistant_message; streaming is a v2 add.

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def connect(self) -> bool:
        if not self.link_token:
            logger.error("BrowserAdapter: BROWSER_LINK_TOKEN must be set")
            self._set_fatal_error(
                "config_missing",
                "BROWSER_LINK_TOKEN must be set",
                retryable=False,
            )
            return False

        try:
            from websockets.asyncio.server import serve  # type: ignore
        except ImportError:
            logger.error("BrowserAdapter requires the `websockets` package")
            self._set_fatal_error(
                "missing_dependency",
                "websockets package is not installed",
                retryable=False,
            )
            return False

        try:
            self._server_cm = serve(self._handle_ws, self.bind_host, self.bind_port)
            self._server = await self._server_cm.__aenter__()
        except OSError as e:
            logger.error("BrowserAdapter: bind %s:%s failed — %s", self.bind_host, self.bind_port, e)
            self._set_fatal_error("bind_failed", str(e), retryable=True)
            return False

        logger.info(
            "BrowserAdapter listening on ws://%s:%d%s",
            self.bind_host,
            self.bind_port,
            self.ws_path,
        )
        self._mark_connected()
        return True

    async def disconnect(self) -> None:
        for conn in list(self._connections.values()):
            try:
                await conn.ws.close(1001, "adapter shutting down")
            except Exception:
                pass
        self._connections.clear()
        try:
            if getattr(self, "_server_cm", None) is not None:
                await self._server_cm.__aexit__(None, None, None)
        except Exception:
            logger.exception("BrowserAdapter: error during server shutdown")
        self._server = None
        self._server_cm = None
        self._mark_disconnected()

    # ── Send (Hermes → browser) ───────────────────────────────────────────

    async def send(
        self,
        chat_id: str,
        content: str,
        reply_to: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> SendResult:
        conn = self._connections.get(chat_id)
        if conn is None:
            # Fall back to home_client_id if explicitly configured
            if self.home_client_id:
                conn = self._connections.get(f"browser:{self.home_client_id}")
            if conn is None and self._connections:
                # Best-effort: pick any live connection
                conn = next(iter(self._connections.values()))
        if conn is None:
            return SendResult(success=False, error="no live browser connection")

        message_id = f"a_{uuid.uuid4().hex[:10]}"
        try:
            await conn.send(
                {
                    "type": "assistant_message",
                    "message_id": message_id,
                    "text": content,
                    "ts": _now_ms(),
                }
            )
        except Exception as e:
            logger.exception("BrowserAdapter.send: failed to deliver to %s", chat_id)
            return SendResult(success=False, error=str(e))
        return SendResult(success=True, message_id=message_id)

    async def send_typing(self, chat_id: str, metadata=None) -> None:
        conn = self._connections.get(chat_id)
        if conn is None:
            return
        try:
            await conn.send({"type": "typing", "on": True})
        except Exception:
            pass

    async def stop_typing(self, chat_id: str) -> None:
        conn = self._connections.get(chat_id)
        if conn is None:
            return
        try:
            await conn.send({"type": "typing", "on": False})
        except Exception:
            pass

    async def get_chat_info(self, chat_id: str) -> Dict[str, Any]:
        return {"name": chat_id, "type": "dm"}

    # ── Tool calls (Hermes → browser → result) ────────────────────────────

    async def call_tool(
        self,
        chat_id: str,
        tool: str,
        arguments: Dict[str, Any],
        *,
        timeout: float = 60.0,
    ) -> Dict[str, Any]:
        """Ask the browser extension to perform a tool and await its result."""
        conn = self._connections.get(chat_id)
        if conn is None:
            raise RuntimeError(f"no live browser connection for {chat_id}")
        call_id = f"c_{uuid.uuid4().hex[:10]}"
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending_tools[call_id] = fut
        await conn.send(
            {
                "type": "tool_call",
                "call_id": call_id,
                "tool": tool,
                "arguments": arguments,
            }
        )
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending_tools.pop(call_id, None)

    # ── Receive (browser → Hermes) ────────────────────────────────────────

    async def _handle_ws(self, ws) -> None:
        path = getattr(getattr(ws, "request", None), "path", "/")
        split = urlsplit(path)
        if split.path != self.ws_path:
            await ws.close(code=4404, reason="path not found")
            return

        qs = parse_qs(split.query)
        token = (qs.get("token") or [""])[0]
        client_id = (qs.get("client_id") or [""])[0]
        if not token or token != self.link_token:
            logger.info("BrowserAdapter: rejecting connection (bad token) from %s", ws.remote_address)
            await ws.close(code=4401, reason="invalid link token")
            return
        if not client_id:
            await ws.close(code=4400, reason="missing client_id")
            return

        chat_id = f"browser:{client_id}"
        # If another connection for this chat_id exists, close the old one.
        old = self._connections.get(chat_id)
        if old is not None:
            try:
                await old.ws.close(1000, "superseded by new connection")
            except Exception:
                pass

        conn = Connection(self, ws, chat_id, client_id)
        self._connections[chat_id] = conn
        logger.info("BrowserAdapter: %s connected from %s", chat_id, ws.remote_address)

        try:
            await conn.send(
                {
                    "type": "welcome",
                    "session_id": f"s_{uuid.uuid4().hex[:10]}",
                    "greeting": f"connected to Hermes as {client_id}",
                }
            )
            async for raw in ws:
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._on_client_message(conn, obj)
        except Exception:
            logger.exception("BrowserAdapter: connection loop error")
        finally:
            if self._connections.get(chat_id) is conn:
                self._connections.pop(chat_id, None)
            logger.info("BrowserAdapter: %s disconnected", chat_id)

    async def _on_client_message(self, conn: "Connection", obj: dict) -> None:
        t = obj.get("type")
        if t == "hello":
            logger.info(
                "BrowserAdapter: hello chat_id=%s tools=%s client_version=%s",
                conn.chat_id,
                obj.get("tools"),
                obj.get("client_version"),
            )
            return
        if t == "ping":
            try:
                await conn.send({"type": "pong", "ts": _now_ms()})
            except Exception:
                pass
            return
        if t == "user_message":
            await self._dispatch_user_message(conn, obj)
            return
        if t == "tool_result":
            call_id = obj.get("call_id")
            fut = self._pending_tools.get(call_id)
            if fut and not fut.done():
                fut.set_result(obj.get("result"))
            return
        logger.debug("BrowserAdapter: ignoring message type=%r", t)

    async def _dispatch_user_message(self, conn: "Connection", obj: dict) -> None:
        text = (obj.get("text") or "").strip()
        page_context = obj.get("page_context") or {}
        message_id = obj.get("message_id") or str(_now_ms())

        # Decorate the user text with a short, structured context preamble.
        # Keep it small and labelled so the agent model can tell page-context
        # apart from the user's actual message.
        context_lines = []
        url = page_context.get("url") or ""
        title = page_context.get("title") or ""
        selection = page_context.get("selection") or ""
        page = page_context.get("page") or {}
        screenshot = page_context.get("screenshot")

        if url or title:
            head = f"[page] {title or '(untitled)'} — {url}".strip()
            context_lines.append(head)
        if selection:
            sel = selection.strip()
            if len(sel) > 1500:
                sel = sel[:1500] + " …(truncated)"
            context_lines.append(f"[selection]\n{sel}")
        if page.get("content_text"):
            body = page["content_text"]
            note = " (truncated)" if page.get("truncated") else ""
            context_lines.append(f"[page text{note}, {page.get('length', len(body))} chars]\n{body}")
        if screenshot:
            context_lines.append("[screenshot attached — base64 JPEG omitted from prompt]")

        if context_lines:
            decorated = "\n\n".join(context_lines) + "\n\n---\n\n" + text
        else:
            decorated = text

        source = self.build_source(
            chat_id=conn.chat_id,
            chat_name=conn.client_id,
            chat_type="dm",
            user_id=conn.client_id,
            user_name=conn.client_id,
        )
        event = MessageEvent(
            text=decorated,
            message_type=MessageType.TEXT,
            source=source,
            message_id=message_id,
            timestamp=_dt.datetime.now(),
        )
        try:
            await self.handle_message(event)
        except Exception:
            logger.exception("BrowserAdapter: handle_message failed")


class Connection:
    def __init__(self, adapter: BrowserAdapter, ws, chat_id: str, client_id: str):
        self.adapter = adapter
        self.ws = ws
        self.chat_id = chat_id
        self.client_id = client_id

    async def send(self, obj: dict) -> None:
        await self.ws.send(json.dumps(obj, ensure_ascii=False))


# ──────────────────────────────────────────────────────────────────────────
# Plugin registration helpers
# ──────────────────────────────────────────────────────────────────────────


def check_requirements() -> bool:
    return bool(os.getenv("BROWSER_LINK_TOKEN"))


def validate_config(config) -> bool:
    extra = getattr(config, "extra", {}) or {}
    token = os.getenv("BROWSER_LINK_TOKEN") or extra.get("link_token", "")
    return bool(token)


def is_connected() -> bool:
    return bool(os.getenv("BROWSER_LINK_TOKEN"))


def _env_enablement() -> Optional[dict]:
    if not os.getenv("BROWSER_LINK_TOKEN"):
        return None
    extra = {
        "link_token": os.getenv("BROWSER_LINK_TOKEN"),
        "bind_host": os.getenv("BROWSER_BIND_HOST", "127.0.0.1"),
        "bind_port": int(os.getenv("BROWSER_BIND_PORT", "18790")),
        "ws_path": os.getenv("BROWSER_WS_PATH", "/ws/browser"),
    }
    home_channel = os.getenv("BROWSER_HOME_CHANNEL", "")
    if home_channel:
        extra["home_client_id"] = home_channel
    return {"extra": extra}


def interactive_setup(_ctx) -> dict:
    return {
        "env_vars": {
            "BROWSER_LINK_TOKEN": {
                "prompt": "Pick a strong random string the browser extension will send as ?token=… (treat as a password)",
                "password": True,
            },
        },
        "post_setup_hint": (
            "Connect from the browser extension at "
            f"ws://{os.getenv('BROWSER_BIND_HOST', '127.0.0.1')}:"
            f"{os.getenv('BROWSER_BIND_PORT', '18790')}"
            f"{os.getenv('BROWSER_WS_PATH', '/ws/browser')}\n"
            "If Hermes is on a remote box, tunnel with:\n"
            "  ssh -L 18790:127.0.0.1:18790 <hermes-host> -N -f"
        ),
    }


def register(ctx):
    """Plugin entry point: called by the Hermes plugin system."""
    ctx.register_platform(
        name="browser",
        label="Browser",
        adapter_factory=lambda cfg: BrowserAdapter(cfg),
        check_fn=check_requirements,
        validate_config=validate_config,
        is_connected=is_connected,
        required_env=["BROWSER_LINK_TOKEN"],
        install_hint="No extra packages needed (websockets is already a Hermes dep).",
        setup_fn=interactive_setup,
        env_enablement_fn=_env_enablement,
    )
