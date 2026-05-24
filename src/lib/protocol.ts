export const PROTOCOL_VERSION = "1";

export type PageContext = {
  url: string;
  title: string;
  selection?: string;
  page?: {
    excerpt?: string;
    content_text: string;
    length: number;
    truncated: boolean;
  };
  screenshot?: {
    mime: "image/png" | "image/jpeg";
    data_base64: string;
  };
  captured_at: number;
};

export type ContextOptions = {
  url_title: boolean;
  selection: boolean;
  page: boolean;
  screenshot: boolean;
};

export type ToolResultPayload =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export type ClientToServer =
  | {
      type: "hello";
      protocol_version: string;
      client_id: string;
      client_version: string;
      ua: string;
      tools: string[];
    }
  | {
      type: "user_message";
      message_id: string;
      text: string;
      page_context?: PageContext;
      ts: number;
    }
  | {
      type: "tool_result";
      call_id: string;
      tool: string;
      result: ToolResultPayload;
      ts: number;
    }
  | { type: "ping"; ts: number }
  | { type: "ack"; message_id: string };

export type ServerToClient =
  | { type: "welcome"; session_id: string; greeting?: string }
  | { type: "typing"; on: boolean }
  | {
      type: "assistant_message_start";
      message_id: string;
      ts: number;
    }
  | {
      type: "assistant_message_delta";
      message_id: string;
      delta: string;
    }
  | {
      type: "assistant_message_end";
      message_id: string;
      ts: number;
    }
  | {
      type: "assistant_message";
      message_id: string;
      text: string;
      ts: number;
    }
  | { type: "system"; level: "info" | "warn" | "error"; message: string }
  | { type: "error"; code: string; message: string }
  | {
      type: "tool_call";
      call_id: string;
      tool: string;
      arguments: Record<string, unknown>;
    }
  | { type: "pong"; ts: number };
