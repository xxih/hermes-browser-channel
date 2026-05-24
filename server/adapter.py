"""
Skeleton BrowserAdapter for dropping into hermes-agent at:
    gateway/platforms/browser/adapter.py

This is a starting point. Confirm against the live BasePlatformAdapter
contract in your hermes-agent checkout (gateway/platforms/ADDING_A_PLATFORM.md)
before wiring up — method signatures may have evolved.

Design notes
------------
- Each `client_id` from the extension maps to one "chat" in Hermes terms.
- We do not maintain a per-tab session: one extension install ↔ one chat,
  so history/agent dispatch behaves like the weixin / telegram adapters do
  per individual.
- `page_context` is exposed to the agent as a structured attachment on the
  user message. Let the model decide what to do with URL/title/selection/
  page/screenshot fields. Do NOT splice the page text into the user prompt
  as raw concatenation — that confuses RLHF'd chat models.
- Tools: Hermes can request the browser to act by emitting `tool_call`. The
  extension enforces per-tool user policy + audit row. Respect `tool_result`
  errors gracefully (denial is normal).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any
from urllib.parse import parse_qs, urlsplit

# Replace with the real import path inside hermes-agent, e.g.:
#   from gateway.base import BasePlatformAdapter, IncomingMessage, OutgoingMessage
# We use Protocol-style placeholders here to keep this file self-contained.


log = logging.getLogger(__name__)


class BasePlatformAdapter:  # pragma: no cover - placeholder
    """Replace with the real hermes-agent base class."""

    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...
    async def send(self, chat_id: str, text: str) -> None: ...
    async def send_typing(self, chat_id: str, on: bool) -> None: ...
    async def send_image(self, chat_id: str, mime: str, data: bytes, caption: str | None = None) -> None: ...
    async def get_chat_info(self, chat_id: str) -> dict[str, Any]: ...
    async def on_incoming(self, chat_id: str, text: str, attachments: dict[str, Any] | None = None) -> None: ...


class BrowserAdapter(BasePlatformAdapter):
    """Browser-as-channel adapter. Pair with the hermes-browser-channel extension."""

    name = "browser"

    def __init__(
        self,
        *,
        bind_host: str = "0.0.0.0",
        bind_port: int = 8765,
        ws_path: str = "/ws/browser",
        token_store: "TokenStore | None" = None,
        agent_dispatch=None,  # callable: (chat_id, text, attachments) -> coroutine producing reply stream
    ):
        self.bind_host = bind_host
        self.bind_port = bind_port
        self.ws_path = ws_path
        self.token_store = token_store or InMemoryTokenStore()
        self.agent_dispatch = agent_dispatch
        self._server = None
        self._connections: dict[str, "Connection"] = {}
        self._pending_tools: dict[str, asyncio.Future] = {}

    async def connect(self) -> None:
        try:
            from websockets.asyncio.server import serve  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "BrowserAdapter requires `websockets` (pip install websockets)"
            ) from e

        async def handler(ws):
            await self._handle_ws(ws)

        self._server_cm = serve(handler, self.bind_host, self.bind_port)
        self._server = await self._server_cm.__aenter__()
        log.info(
            "BrowserAdapter listening on ws://%s:%d%s",
            self.bind_host,
            self.bind_port,
            self.ws_path,
        )

    async def disconnect(self) -> None:
        if self._server_cm is not None:
            await self._server_cm.__aexit__(None, None, None)
            self._server = None

    # ---- send-side: hermes → browser ----

    async def send(self, chat_id: str, text: str) -> None:
        conn = self._connections.get(chat_id)
        if not conn:
            log.warning("send(): no live connection for %s, dropping", chat_id)
            return
        await conn.send_assistant_message(text)

    async def send_typing(self, chat_id: str, on: bool) -> None:
        conn = self._connections.get(chat_id)
        if conn:
            await conn.send({"type": "typing", "on": on})

    async def send_image(self, chat_id: str, mime: str, data: bytes, caption: str | None = None) -> None:
        # Browser extension can render images inline if you teach it to —
        # for v0, we just send the caption text.
        if caption:
            await self.send(chat_id, caption)

    async def call_tool(
        self,
        chat_id: str,
        tool: str,
        arguments: dict[str, Any],
        *,
        timeout: float = 60.0,
    ) -> Any:
        """Ask the browser to run a tool and await its result."""
        conn = self._connections.get(chat_id)
        if not conn:
            raise RuntimeError(f"no live browser connection for {chat_id}")
        call_id = f"c_{uuid.uuid4().hex[:10]}"
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending_tools[call_id] = fut
        await conn.send({"type": "tool_call", "call_id": call_id, "tool": tool, "arguments": arguments})
        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        finally:
            self._pending_tools.pop(call_id, None)

    # ---- recv-side: browser → hermes ----

    async def _handle_ws(self, ws) -> None:
        path = ws.request.path
        split = urlsplit(path)
        if split.path != self.ws_path:
            await ws.close(code=4404, reason="path not found")
            return
        qs = parse_qs(split.query)
        token = (qs.get("token") or [""])[0]
        client_id = (qs.get("client_id") or [""])[0]
        if not client_id:
            await ws.close(code=4400, reason="missing client_id")
            return
        chat_id = await self.token_store.resolve(token, client_id)
        if not chat_id:
            await ws.close(code=4401, reason="invalid link token")
            return

        conn = Connection(self, ws, chat_id)
        self._connections[chat_id] = conn
        try:
            await conn.send(
                {
                    "type": "welcome",
                    "session_id": f"s_{uuid.uuid4().hex[:10]}",
                    "greeting": f"connected as {chat_id}",
                }
            )
            async for raw in ws:
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._on_client_message(conn, obj)
        finally:
            if self._connections.get(chat_id) is conn:
                del self._connections[chat_id]

    async def _on_client_message(self, conn: "Connection", obj: dict) -> None:
        t = obj.get("type")
        if t == "hello":
            log.info("hello chat_id=%s tools=%s", conn.chat_id, obj.get("tools"))
            return
        if t == "ping":
            await conn.send({"type": "pong", "ts": int(time.time() * 1000)})
            return
        if t == "user_message":
            attachments = obj.get("page_context")
            text = obj.get("text", "")
            if self.agent_dispatch is None:
                # Echo until the user wires up agent_dispatch
                await conn.send_assistant_message(f"[no agent_dispatch wired] echo: {text}")
                return
            asyncio.create_task(
                self._run_agent_and_stream(conn, text, attachments),
            )
            return
        if t == "tool_result":
            call_id = obj.get("call_id")
            fut = self._pending_tools.get(call_id)
            if fut and not fut.done():
                fut.set_result(obj.get("result"))
            return

    async def _run_agent_and_stream(self, conn: "Connection", text: str, attachments: dict | None) -> None:
        message_id = f"a_{uuid.uuid4().hex[:10]}"
        await conn.send({"type": "assistant_message_start", "message_id": message_id, "ts": int(time.time() * 1000)})
        try:
            async for delta in self.agent_dispatch(conn.chat_id, text, attachments):
                await conn.send({"type": "assistant_message_delta", "message_id": message_id, "delta": delta})
        except Exception as e:
            log.exception("agent_dispatch failed")
            await conn.send({"type": "error", "code": "agent_failed", "message": str(e)})
        finally:
            await conn.send({"type": "assistant_message_end", "message_id": message_id, "ts": int(time.time() * 1000)})


class Connection:
    def __init__(self, adapter: BrowserAdapter, ws, chat_id: str):
        self.adapter = adapter
        self.ws = ws
        self.chat_id = chat_id

    async def send(self, obj: dict) -> None:
        await self.ws.send(json.dumps(obj))

    async def send_assistant_message(self, text: str) -> None:
        await self.send(
            {
                "type": "assistant_message",
                "message_id": f"a_{uuid.uuid4().hex[:10]}",
                "text": text,
                "ts": int(time.time() * 1000),
            }
        )


class TokenStore:
    async def resolve(self, token: str, client_id: str) -> str | None:
        raise NotImplementedError


class InMemoryTokenStore(TokenStore):
    """Dev-only: any token works; chat_id = client_id."""

    async def resolve(self, token: str, client_id: str) -> str | None:
        if not token:
            return None
        return f"browser:{client_id}"
