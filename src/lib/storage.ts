export type Settings = {
  endpoint: string;
  token: string;
  client_id: string;
  default_context: {
    url_title: boolean;
    selection: boolean;
    page: boolean;
    screenshot: boolean;
  };
  max_page_chars: number;
  tool_policy?: Record<string, { enabled: boolean }>;
  auto_confirm_writes: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  endpoint: "",
  token: "",
  client_id: "",
  default_context: {
    url_title: true,
    selection: true,
    page: false,
    screenshot: false,
  },
  max_page_chars: 20000,
  auto_confirm_writes: false,
};

const KEY = "hermes_browser_channel_settings";

export async function loadSettings(): Promise<Settings> {
  const obj = await chrome.storage.local.get(KEY);
  const stored = (obj?.[KEY] ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored, default_context: { ...DEFAULT_SETTINGS.default_context, ...(stored.default_context ?? {}) } };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await loadSettings();
  const next = { ...cur, ...patch, default_context: { ...cur.default_context, ...(patch.default_context ?? {}) } };
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export type ChatMessage =
  | { id: string; role: "user"; text: string; ts: number; has_context: boolean }
  | { id: string; role: "assistant"; text: string; ts: number; streaming?: boolean }
  | { id: string; role: "system"; text: string; ts: number; level?: "info" | "warn" | "error" }
  | {
      id: string;
      role: "tool";
      ts: number;
      call_id: string;
      tool: string;
      args: Record<string, unknown>;
      state: "pending" | "running" | "ok" | "error" | "denied";
      summary?: string;
      error?: string;
    };

const HISTORY_KEY = "hermes_browser_channel_history";
const HISTORY_LIMIT = 500;

export async function loadHistory(): Promise<ChatMessage[]> {
  const obj = await chrome.storage.local.get(HISTORY_KEY);
  return (obj?.[HISTORY_KEY] ?? []) as ChatMessage[];
}

export async function saveHistory(history: ChatMessage[]): Promise<void> {
  const trimmed = history.slice(-HISTORY_LIMIT);
  await chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}
