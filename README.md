# Hermes Browser Channel

A Chrome side-panel extension that turns your browser into a **first-class channel** for [Hermes](https://github.com/NousResearch/hermes-agent) — exactly like WeChat / Telegram / Discord channels, but for the place you actually live while studying or working.

Send the page you're looking at to your agent. Attach selection, full page text, or a screenshot. Let the agent reach back through optional tools (open a tab, copy to clipboard, click a button, …) — **opt-in per tool, audited in the chat thread**.

## What this is and is not

**Is**

- A chat sidebar that talks to your self-hosted Hermes over WebSocket.
- A way to hand the agent rich, structured context from the current page without copy-pasting.
- A tool surface the agent can call back into — gated by your per-tool policy, visible in the chat as an audit row, with `[confirm]` prompts for risky writes.

**Is not**

- A general-purpose browser automation runtime (think Playwright/Puppeteer-as-a-service). Tools are coarse-grained shortcuts, not a CDP firehose.
- A spyware extension. No background data collection. Scripting injects only on user invocation (the active tab when you click Send / when the agent issues a tool call you've enabled).

The design intentionally avoids the path that got OpenClaw's Chrome Extension Relay [removed in 2026.3.22](https://github.com/openclaw/openclaw/issues/55840): no silent global control, no token/cookie scraping, every action audited.

## Architecture

```
┌──────────────────────────────────────┐         ┌────────────────────────┐
│ Chrome extension                     │  WSS    │ Hermes gateway         │
│ ┌────────────┐  ┌──────────────────┐ │ ──────► │ gateway/platforms/     │
│ │ sidepanel  │◄─┤ background SW    │ │ ◄────── │   browser/adapter.py   │
│ │ (chat UI)  │  │ (WS, tools, ctx) │ │         │                        │
│ └────────────┘  └──────────────────┘ │         └──────────┬─────────────┘
│                    │  scripting on   │                    │
│                    │  active tab     │                    ▼
│                    ▼                 │              Hermes agent
│            page DOM (read on demand) │            (your usual model + tools)
└──────────────────────────────────────┘
```

- **Sidepanel** (`src/sidepanel/`) — React chat UI with composer, context chips (URL / Sel / Page / Shot), tool audit rows, settings link.
- **Background service worker** (`src/background/service-worker.ts`) — persistent WebSocket, per-tool dispatch, page-context capture orchestration, reconnect/backoff, alarm-based keepalive ping.
- **Tools** (`src/lib/tools.ts`) — declarative registry: name, trust level (`read` / `light_write` / `write`), default_enabled, requires_confirmation. Add a new tool by appending one entry + one switch case.
- **Server side** (`server/`) — standalone echo server for development, and a `BrowserAdapter` skeleton to drop into `hermes-agent/gateway/platforms/browser/`. Wire protocol in `server/protocol.py` (mirrors `src/lib/protocol.ts`).

## Quick start (dev)

You need Node 20+ and pnpm 9+, plus Python 3.11+ to run the echo server.

```bash
# 1. extension
pnpm install
pnpm dev          # produces dist/ with HMR; load it as an unpacked extension

# 2. echo server (in another shell)
cd server
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python echo_server.py
```

Load the extension:

1. Open `chrome://extensions`.
2. Toggle **Developer mode**.
3. **Load unpacked** → select the repo's `dist/` directory.
4. Pin the extension. Click its icon to open the side panel.
5. Click the gear (⚙) in the panel to open Options. Set:
   - **WebSocket URL:** `ws://127.0.0.1:8765/ws/browser`
   - **Link token:** anything (echo server accepts all)

The connection dot should turn green. Type a message. Try these to exercise tools:

| You type            | What happens                                         |
|---------------------|------------------------------------------------------|
| `read page`         | server asks the extension to extract page text       |
| `screenshot`        | server asks the extension to capture a screenshot    |
| `tabs`              | server asks for the open-tab list                    |
| `open https://…`    | server asks the extension to open a new tab          |
| `copy hello world`  | server asks to write to the clipboard                |
| `fill #q=hello`     | server asks to fill an input (write — needs confirm) |

## Production build

```bash
pnpm build
```

Produces `dist/`. Zip it for `chrome.google.com/webstore` if you publish, or distribute as an unpacked extension.

## Connecting to real Hermes

1. Implement `agent_dispatch` and a `TokenStore` against your user database, then drop `server/adapter.py` into `hermes-agent/gateway/platforms/browser/`.
2. Make sure your gateway exposes the WS path (default `/ws/browser`) on a TLS-terminated origin reachable from the user's browser. `wss://` is required for any non-localhost endpoint.
3. Issue each user a link token, persist it in your TokenStore, and have them paste it into the extension's Options.

See `server/README.md` for the wire protocol and integration notes.

## Tool reference

| Tool             | Trust       | Default | Confirm? |
|------------------|-------------|---------|----------|
| `read_page`      | read        | on      | no       |
| `get_selection`  | read        | on      | no       |
| `screenshot`     | read        | on      | no       |
| `dom_query`      | read        | off     | no       |
| `list_tabs`      | read        | off     | no       |
| `open_url`       | light_write | on      | no       |
| `write_clipboard`| light_write | on      | no       |
| `download_url`   | light_write | off     | yes      |
| `scroll_to`      | light_write | off     | no       |
| `click`          | write       | off     | yes      |
| `fill_input`     | write       | off     | yes      |

All tools log into the chat thread as an audit row with status (`running` / `ok` / `error` / `denied`). You can flip "auto-confirm writes" in Options if you trust your agent.

## Permissions

- `storage` — settings + chat history (chrome.storage.local).
- `sidePanel` — the chat surface.
- `scripting` + `activeTab` — read page DOM and run tools, only on the tab you're on, only when you (or the agent, via a tool you've enabled) trigger it. No `<all_urls>` host permission requested.
- `tabs` — enumerate open tabs for `list_tabs`, open new tabs for `open_url`.
- `downloads` — for `download_url` (off by default).
- `offscreen` — for clipboard writes (Chrome's MV3 clipboard pattern).
- `alarms` — periodic WS ping to keep the connection healthy.

## License

MIT — see `LICENSE`.
