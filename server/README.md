# Hermes-side adapter for the browser channel

This directory contains:

- **`protocol.py`** — Pydantic models matching the extension's `src/lib/protocol.ts`. Authoritative wire format.
- **`echo_server.py`** — A standalone WebSocket server you can run **without Hermes** to develop and debug the extension end-to-end. Echoes user messages back and demonstrates tool calls.
- **`adapter.py`** — Skeleton `BrowserAdapter(BasePlatformAdapter)` for dropping into `hermes-agent/gateway/platforms/browser/`. See `ADDING_A_PLATFORM.md` in the hermes-agent repo before wiring up — the BasePlatformAdapter contract may have changed since this skeleton was written; treat method signatures as a starting point.

## Quick start (without Hermes)

```bash
cd server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python echo_server.py
```

This starts a WebSocket server at `ws://127.0.0.1:8765/ws/browser`. In the extension Options, set:

- **WebSocket URL:** `ws://127.0.0.1:8765/ws/browser`
- **Link token:** `dev-token` (any string; the echo server doesn't validate)

You should see the connection indicator go green. Send a message — the echo server replies. Try saying `screenshot` to see a `tool_call` round-trip.

## Wire protocol summary

The extension connects with `?token=<link_token>&client_id=<uuid>&protocol=1`.

**Client → server:**
- `hello` — sent right after open. Includes the list of tools the user has enabled.
- `user_message` — text + optional `page_context` attachment (`url`, `title`, `selection`, `page.content_text`, `screenshot`).
- `tool_result` — response to a server-issued `tool_call`.
- `ping` — periodic heartbeat.

**Server → client:**
- `welcome` — optional greeting after auth.
- `assistant_message` — full reply (non-streaming).
- `assistant_message_start` / `_delta` / `_end` — streaming reply.
- `tool_call` — ask the browser to do something (`open_url`, `screenshot`, …). The extension respects per-tool user policy and may pop a confirmation row before running.
- `typing` — show a typing indicator.
- `system` — info/warn/error notice rendered in the chat thread.

Full schema lives in `protocol.py`.

## Integrating into hermes-agent

1. Copy `adapter.py` to `hermes-agent/gateway/platforms/browser/adapter.py` and rename the class if your convention differs.
2. Mount the `aiohttp` (or whatever the gateway uses) WebSocket route at a path you like (e.g. `/ws/browser`).
3. Wire incoming `user_message` events to Hermes' normal agent dispatch using `client_id` as the per-user session key. Treat `page_context` as a structured attachment on the user message (don't inline it as raw text — let the agent model decide what to do with the URL/title/selection/page/screenshot fields).
4. To call tools, emit `tool_call` events; await `tool_result` keyed by `call_id`.
5. Auth: validate `?token=` against your per-user link-token store. Reject the upgrade with HTTP 401 if the token is unknown.
