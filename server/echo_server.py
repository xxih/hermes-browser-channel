"""
Standalone development WebSocket server. Lets you run the browser-channel
extension without spinning up a real Hermes deployment.

Behavior:
  - Accepts any token and any client_id.
  - Streams a canned reply for every user_message.
  - Trigger words demonstrate tool round-trips:
      "screenshot"   → tool_call screenshot
      "open <url>"   → tool_call open_url
      "tabs"         → tool_call list_tabs
      "copy <text>"  → tool_call write_clipboard
      "fill <css>=<value>" → tool_call fill_input (write trust, may need user confirm)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from urllib.parse import parse_qs, urlsplit

from websockets.asyncio.server import ServerConnection, serve

from protocol import (
    AssistantMessageDeltaOut,
    AssistantMessageEndOut,
    AssistantMessageStartOut,
    SystemOut,
    ToolCallOut,
    WelcomeOut,
    parse_client,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("echo")


async def send(ws: ServerConnection, model) -> None:
    await ws.send(model.model_dump_json())


async def stream_reply(ws: ServerConnection, text: str) -> None:
    message_id = f"a_{uuid.uuid4().hex[:10]}"
    now = int(time.time() * 1000)
    await send(ws, AssistantMessageStartOut(message_id=message_id, ts=now))
    chunk = 24
    for i in range(0, len(text), chunk):
        await send(ws, AssistantMessageDeltaOut(message_id=message_id, delta=text[i : i + chunk]))
        await asyncio.sleep(0.04)
    await send(ws, AssistantMessageEndOut(message_id=message_id, ts=int(time.time() * 1000)))


async def issue_tool(ws: ServerConnection, tool: str, arguments: dict, *, timeout: float = 30.0):
    call_id = f"c_{uuid.uuid4().hex[:10]}"
    await send(ws, ToolCallOut(call_id=call_id, tool=tool, arguments=arguments))
    return call_id


async def maybe_dispatch_tool(ws: ServerConnection, text: str) -> bool:
    """Return True if a trigger word was matched and a tool was issued."""
    t = text.strip()
    if t.lower() == "screenshot":
        await issue_tool(ws, "screenshot", {})
        return True
    if t.lower() == "tabs":
        await issue_tool(ws, "list_tabs", {})
        return True
    m = re.match(r"^open\s+(https?://\S+)\s*$", t, re.I)
    if m:
        await issue_tool(ws, "open_url", {"url": m.group(1), "active": False})
        return True
    m = re.match(r"^copy\s+(.+)$", t, re.I | re.S)
    if m:
        await issue_tool(ws, "write_clipboard", {"text": m.group(1)})
        return True
    m = re.match(r"^fill\s+(\S+)\s*=\s*(.+)$", t, re.I | re.S)
    if m:
        await issue_tool(ws, "fill_input", {"selector": m.group(1), "value": m.group(2)})
        return True
    m = re.match(r"^read\s+page\s*$", t, re.I)
    if m:
        await issue_tool(ws, "read_page", {"include_selection": True})
        return True
    return False


async def handle(ws: ServerConnection):
    qs = parse_qs(urlsplit(ws.request.path).query)
    client_id = (qs.get("client_id") or ["anon"])[0]
    log.info("connect client_id=%s remote=%s", client_id, ws.remote_address)
    session_id = f"s_{uuid.uuid4().hex[:10]}"
    await send(
        ws,
        WelcomeOut(
            session_id=session_id,
            greeting=f"connected to echo server as {client_id}. type 'screenshot', 'tabs', 'read page', 'open https://…', 'copy …', or 'fill <selector>=<value>' to exercise tools.",
        ),
    )

    try:
        async for raw in ws:
            try:
                obj = json.loads(raw)
                msg = parse_client(obj)
            except Exception as e:
                await send(ws, SystemOut(level="error", message=f"parse error: {e}"))
                continue

            mtype = msg.type
            if mtype == "hello":
                log.info("hello tools=%s version=%s ua=%s", msg.tools, msg.client_version, msg.ua[:40])
                continue
            if mtype == "ping":
                await ws.send(json.dumps({"type": "pong", "ts": int(time.time() * 1000)}))
                continue
            if mtype == "user_message":
                ctx = msg.page_context
                hint = ""
                if ctx:
                    parts = []
                    if ctx.url:
                        parts.append(f"url={ctx.url}")
                    if ctx.title:
                        parts.append(f"title={ctx.title[:50]!r}")
                    if ctx.selection:
                        parts.append(f"selection={len(ctx.selection)}ch")
                    if ctx.page:
                        parts.append(f"page={ctx.page.length}ch{' (truncated)' if ctx.page.truncated else ''}")
                    if ctx.screenshot:
                        parts.append("screenshot=yes")
                    if parts:
                        hint = "\n\n[context received: " + ", ".join(parts) + "]"
                if await maybe_dispatch_tool(ws, msg.text):
                    await stream_reply(ws, f"issued tool call for: {msg.text!r}{hint}")
                else:
                    await stream_reply(ws, f"echo: {msg.text}{hint}")
                continue
            if mtype == "tool_result":
                if msg.result.ok:
                    summary = json.dumps(msg.result.result)[:200]
                    await stream_reply(ws, f"tool {msg.tool} returned: {summary}")
                else:
                    await stream_reply(ws, f"tool {msg.tool} failed: {msg.result.error}")
                continue
    except Exception as e:
        log.warning("connection error: %s", e)
    finally:
        log.info("disconnect client_id=%s", client_id)


async def main():
    async with serve(handle, "127.0.0.1", 8765):
        log.info("echo server listening on ws://127.0.0.1:8765/ws/browser")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
