import { capturePageContext } from "@/lib/page-context";
import type {
  BgToSidepanel,
  ConnectionState,
  PendingToolCall,
  SidepanelToBg,
} from "@/lib/messages";
import type { ClientToServer, ServerToClient } from "@/lib/protocol";
import { PROTOCOL_VERSION } from "@/lib/protocol";
import { uuid } from "@/lib/id";
import { loadSettings, saveSettings } from "@/lib/storage";
import {
  TOOL_SPECS,
  defaultToolPolicy,
  enabledToolNames,
  executeTool,
  toolNeedsConfirmation,
} from "@/lib/tools";

const KEEPALIVE_ALARM = "hermes-keepalive";
const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 30_000;

let ws: WebSocket | null = null;
let wsState: ConnectionState = "idle";
let wsStateDetail: string | undefined;
let backoffMs = 1_000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let lastPingTs = 0;
const ports = new Set<chrome.runtime.Port>();
const pendingTools = new Map<string, PendingToolCall>();

function broadcast(msg: BgToSidepanel): void {
  for (const p of ports) {
    try {
      p.postMessage(msg);
    } catch {
      ports.delete(p);
    }
  }
}

function setConnState(state: ConnectionState, detail?: string): void {
  wsState = state;
  wsStateDetail = detail;
  broadcast({ kind: "connection", state, detail });
}

async function ensureClientId(): Promise<string> {
  const s = await loadSettings();
  if (s.client_id) return s.client_id;
  const next = await saveSettings({ client_id: uuid() });
  return next.client_id;
}

function send(msg: ClientToServer): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

function summarizeToolResult(tool: string, result: unknown): string {
  if (result == null) return "ok";
  if (typeof result === "string") return result.slice(0, 120);
  if (typeof result === "object") {
    try {
      const obj = result as Record<string, unknown>;
      if (tool === "read_page" && "page" in obj) {
        const len = (obj.page as { length?: number } | undefined)?.length ?? 0;
        return `${len} chars`;
      }
      if (tool === "screenshot" && "data_base64" in obj) {
        return "image captured";
      }
      const keys = Object.keys(obj).slice(0, 3).join(", ");
      return keys ? `{${keys}}` : "ok";
    } catch {
      return "ok";
    }
  }
  return String(result);
}

async function runAndReport(call: PendingToolCall): Promise<void> {
  broadcast({ kind: "tool_call_update", update: { phase: "running", call_id: call.call_id } });
  const result = await executeTool(call.tool, call.arguments);
  if (result.ok) {
    broadcast({
      kind: "tool_call_update",
      update: { phase: "ok", call_id: call.call_id, summary: summarizeToolResult(call.tool, result.result) },
    });
  } else {
    broadcast({
      kind: "tool_call_update",
      update: { phase: "error", call_id: call.call_id, error: result.error },
    });
  }
  send({
    type: "tool_result",
    call_id: call.call_id,
    tool: call.tool,
    result,
    ts: Date.now(),
  });
}

async function handleToolCall(event: ServerToClient & { type: "tool_call" }): Promise<void> {
  const call: PendingToolCall = {
    call_id: event.call_id,
    tool: event.tool,
    arguments: event.arguments,
    ts: Date.now(),
  };
  pendingTools.set(call.call_id, call);
  broadcast({
    kind: "tool_call_update",
    update: { phase: "pending", call_id: call.call_id, tool: call.tool, arguments: call.arguments, ts: call.ts },
  });
  const s = await loadSettings();
  const needs = toolNeedsConfirmation(call.tool);
  if (needs && !s.auto_confirm_writes) {
    return;
  }
  pendingTools.delete(call.call_id);
  await runAndReport(call);
}

async function connect(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const settings = await loadSettings();
  if (!settings.endpoint) {
    setConnState("idle", "endpoint not configured — open Options");
    return;
  }
  const client_id = await ensureClientId();
  let url: URL;
  try {
    url = new URL(settings.endpoint);
  } catch {
    setConnState("error", "invalid endpoint URL");
    return;
  }
  if (settings.token) url.searchParams.set("token", settings.token);
  url.searchParams.set("client_id", client_id);
  url.searchParams.set("protocol", PROTOCOL_VERSION);

  setConnState("connecting", url.host);

  try {
    ws = new WebSocket(url.toString());
  } catch (e) {
    setConnState("error", String((e as Error).message ?? e));
    scheduleReconnect();
    return;
  }

  ws.onopen = async () => {
    backoffMs = 1_000;
    setConnState("open");
    const tools = await enabledToolNames();
    send({
      type: "hello",
      protocol_version: PROTOCOL_VERSION,
      client_id,
      client_version: chrome.runtime.getManifest().version,
      ua: navigator.userAgent,
      tools,
    });
  };

  ws.onmessage = (ev) => {
    let event: ServerToClient | null = null;
    try {
      event = JSON.parse(ev.data as string) as ServerToClient;
    } catch {
      return;
    }
    if (!event) return;
    if (event.type === "pong") return;
    if (event.type === "tool_call") {
      void handleToolCall(event);
      return;
    }
    broadcast({ kind: "server_event", event });
  };

  ws.onerror = () => {
    setConnState("error", "websocket error");
  };

  ws.onclose = (ev) => {
    setConnState("closed", `code=${ev.code} ${ev.reason || ""}`.trim());
    scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = Math.min(backoffMs, MAX_BACKOFF_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    void connect();
  }, delay);
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close(1000, "client disconnect");
    } catch {
      // ignore
    }
    ws = null;
  }
}

async function handleSidepanelMessage(msg: SidepanelToBg, port: chrome.runtime.Port): Promise<void> {
  switch (msg.kind) {
    case "subscribe": {
      port.postMessage({ kind: "connection", state: wsState, detail: wsStateDetail } satisfies BgToSidepanel);
      break;
    }
    case "reconnect": {
      disconnect();
      backoffMs = 1_000;
      void connect();
      break;
    }
    case "send_message": {
      const settings = await loadSettings();
      let page_context;
      try {
        page_context = await capturePageContext(msg.context_options, settings.max_page_chars);
      } catch (e) {
        broadcast({
          kind: "server_event",
          event: {
            type: "system",
            level: "warn",
            message: `context capture failed: ${(e as Error).message}`,
          },
        });
      }
      const ok = send({
        type: "user_message",
        message_id: msg.message_id,
        text: msg.text,
        page_context,
        ts: Date.now(),
      });
      if (!ok) {
        broadcast({
          kind: "server_event",
          event: {
            type: "error",
            code: "not_connected",
            message: "not connected to Hermes — message not sent",
          },
        });
      }
      break;
    }
    case "preview_context": {
      const settings = await loadSettings();
      try {
        const context = await capturePageContext(msg.options, settings.max_page_chars);
        port.postMessage({
          kind: "server_event",
          event: {
            type: "system",
            level: "info",
            message: `preview ok: url=${context.url || "(omitted)"} selection=${context.selection ? `${context.selection.length}ch` : "—"} page=${context.page ? `${context.page.length}ch` : "—"} screenshot=${context.screenshot ? "yes" : "no"}`,
          },
        } satisfies BgToSidepanel);
      } catch (e) {
        port.postMessage({
          kind: "server_event",
          event: { type: "system", level: "warn", message: `preview failed: ${(e as Error).message}` },
        } satisfies BgToSidepanel);
      }
      break;
    }
    case "confirm_tool": {
      const call = pendingTools.get(msg.call_id);
      if (!call) return;
      pendingTools.delete(msg.call_id);
      if (!msg.approved) {
        broadcast({ kind: "tool_call_update", update: { phase: "denied", call_id: msg.call_id } });
        send({
          type: "tool_result",
          call_id: msg.call_id,
          tool: call.tool,
          result: { ok: false, error: "denied by user" },
          ts: Date.now(),
        });
        return;
      }
      await runAndReport(call);
      break;
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;
  ports.add(port);
  port.onMessage.addListener((msg: SidepanelToBg) => {
    void handleSidepanelMessage(msg, port);
  });
  port.onDisconnect.addListener(() => {
    ports.delete(port);
  });
  port.postMessage({ kind: "connection", state: wsState, detail: wsStateDetail } satisfies BgToSidepanel);
  if (wsState === "idle" || wsState === "closed" || wsState === "error") {
    void connect();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  const s = await loadSettings();
  if (!s.tool_policy) {
    await saveSettings({ tool_policy: defaultToolPolicy() });
  }
  void connect();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  void connect();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  if (ws && ws.readyState === WebSocket.OPEN) {
    const now = Date.now();
    if (now - lastPingTs > PING_INTERVAL_MS) {
      lastPingTs = now;
      send({ type: "ping", ts: now });
    }
  } else if (ports.size > 0 && (wsState === "closed" || wsState === "error" || wsState === "idle")) {
    void connect();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("hermes_browser_channel_settings" in changes) {
    const before = changes.hermes_browser_channel_settings.oldValue ?? {};
    const after = changes.hermes_browser_channel_settings.newValue ?? {};
    if (before.endpoint !== after.endpoint || before.token !== after.token) {
      disconnect();
      backoffMs = 1_000;
      void connect();
    }
  }
});

// Export referenced types so TS doesn't drop them
export type _Exports = { TOOL_SPECS: typeof TOOL_SPECS };

void connect();
