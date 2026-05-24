import type { ContextOptions, PageContext, ServerToClient } from "./protocol";

export type ConnectionState = "idle" | "connecting" | "open" | "closed" | "error";

export type PendingToolCall = {
  call_id: string;
  tool: string;
  arguments: Record<string, unknown>;
  ts: number;
};

export type ToolCallUpdate =
  | { phase: "pending"; call_id: string; tool: string; arguments: Record<string, unknown>; ts: number }
  | { phase: "running"; call_id: string }
  | { phase: "ok"; call_id: string; summary: string }
  | { phase: "error"; call_id: string; error: string }
  | { phase: "denied"; call_id: string };

export type BgToSidepanel =
  | { kind: "connection"; state: ConnectionState; detail?: string }
  | { kind: "server_event"; event: ServerToClient }
  | { kind: "capture_progress"; stage: string }
  | { kind: "tool_call_update"; update: ToolCallUpdate };

export type SidepanelToBg =
  | { kind: "subscribe" }
  | {
      kind: "send_message";
      message_id: string;
      text: string;
      context_options: ContextOptions;
    }
  | { kind: "reconnect" }
  | { kind: "preview_context"; options: ContextOptions }
  | { kind: "confirm_tool"; call_id: string; approved: boolean };

export type PreviewContextResult =
  | { ok: true; context: PageContext }
  | { ok: false; error: string };
