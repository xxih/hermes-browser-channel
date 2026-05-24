import { capturePageContext } from "./page-context";
import type { ToolResultPayload } from "./protocol";
import { loadSettings } from "./storage";

export type ToolTrust = "read" | "light_write" | "write";

export type ToolSpec = {
  name: string;
  description: string;
  trust: ToolTrust;
  default_enabled: boolean;
  requires_confirmation: boolean;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
};

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "read_page",
    description: "Read the visible page main text and meta from the active tab.",
    trust: "read",
    default_enabled: true,
    requires_confirmation: false,
    parameters: {
      include_selection: { type: "boolean", description: "Include current selection if any." },
      include_screenshot: { type: "boolean", description: "Capture a JPEG screenshot of the visible viewport." },
    },
  },
  {
    name: "get_selection",
    description: "Return only the currently selected text in the active tab.",
    trust: "read",
    default_enabled: true,
    requires_confirmation: false,
    parameters: {},
  },
  {
    name: "screenshot",
    description: "Capture a JPEG screenshot of the active tab's visible viewport.",
    trust: "read",
    default_enabled: true,
    requires_confirmation: false,
    parameters: {},
  },
  {
    name: "dom_query",
    description: "Run a CSS selector against the active tab and return the inner text of matching elements (capped).",
    trust: "read",
    default_enabled: false,
    requires_confirmation: false,
    parameters: {
      selector: { type: "string", description: "CSS selector.", required: true },
      limit: { type: "number", description: "Max elements (default 20)." },
    },
  },
  {
    name: "list_tabs",
    description: "List currently open tabs in the current window (URL + title only).",
    trust: "read",
    default_enabled: false,
    requires_confirmation: false,
    parameters: {},
  },
  {
    name: "open_url",
    description: "Open a URL in a new browser tab.",
    trust: "light_write",
    default_enabled: true,
    requires_confirmation: false,
    parameters: {
      url: { type: "string", description: "Absolute URL.", required: true },
      active: { type: "boolean", description: "Whether to focus the new tab (default false)." },
    },
  },
  {
    name: "write_clipboard",
    description: "Write a string to the user's clipboard via offscreen document.",
    trust: "light_write",
    default_enabled: true,
    requires_confirmation: false,
    parameters: {
      text: { type: "string", description: "Text to copy.", required: true },
    },
  },
  {
    name: "download_url",
    description: "Download a URL via chrome.downloads (user sees the standard download UI).",
    trust: "light_write",
    default_enabled: false,
    requires_confirmation: true,
    parameters: {
      url: { type: "string", description: "Absolute URL.", required: true },
      filename: { type: "string", description: "Suggested filename." },
    },
  },
  {
    name: "scroll_to",
    description: "Scroll the active tab to a CSS selector.",
    trust: "light_write",
    default_enabled: false,
    requires_confirmation: false,
    parameters: {
      selector: { type: "string", description: "CSS selector.", required: true },
    },
  },
  {
    name: "click",
    description: "Click an element matching a CSS selector in the active tab.",
    trust: "write",
    default_enabled: false,
    requires_confirmation: true,
    parameters: {
      selector: { type: "string", description: "CSS selector.", required: true },
    },
  },
  {
    name: "fill_input",
    description: "Set the value of an input/textarea matching a CSS selector and dispatch input/change events.",
    trust: "write",
    default_enabled: false,
    requires_confirmation: true,
    parameters: {
      selector: { type: "string", description: "CSS selector for an input or textarea.", required: true },
      value: { type: "string", description: "Value to set.", required: true },
    },
  },
];

export type ToolPolicy = Record<string, { enabled: boolean }>;

export function defaultToolPolicy(): ToolPolicy {
  const p: ToolPolicy = {};
  for (const s of TOOL_SPECS) p[s.name] = { enabled: s.default_enabled };
  return p;
}

export async function enabledToolNames(): Promise<string[]> {
  const s = await loadSettings();
  const policy = s.tool_policy ?? defaultToolPolicy();
  return TOOL_SPECS.filter((t) => policy[t.name]?.enabled ?? t.default_enabled).map((t) => t.name);
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.id) throw new Error("no active tab");
  return tab;
}

function injectableOrThrow(tab: chrome.tabs.Tab): void {
  const url = tab.url ?? "";
  if (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  ) {
    throw new Error(`cannot script ${url}`);
  }
}

const OFFSCREEN_PATH = "src/offscreen/clipboard.html";

async function ensureOffscreen(): Promise<void> {
  if (!chrome.offscreen) throw new Error("offscreen API unavailable");
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["CLIPBOARD" as chrome.offscreen.Reason],
    justification: "Write text to the user's clipboard at agent request.",
  });
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResultPayload> {
  const settings = await loadSettings();
  const policy = settings.tool_policy ?? defaultToolPolicy();
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) return { ok: false, error: `unknown tool ${name}` };
  if (!(policy[name]?.enabled ?? spec.default_enabled)) {
    return { ok: false, error: `tool "${name}" disabled by user policy` };
  }

  switch (name) {
    case "read_page": {
      const ctx = await capturePageContext(
        {
          url_title: true,
          selection: Boolean(args.include_selection),
          page: true,
          screenshot: Boolean(args.include_screenshot),
        },
        settings.max_page_chars,
      );
      return { ok: true, result: ctx };
    }
    case "get_selection": {
      const ctx = await capturePageContext(
        { url_title: true, selection: true, page: false, screenshot: false },
        settings.max_page_chars,
      );
      return { ok: true, result: { selection: ctx.selection ?? "", url: ctx.url, title: ctx.title } };
    }
    case "screenshot": {
      const ctx = await capturePageContext(
        { url_title: true, selection: false, page: false, screenshot: true },
        settings.max_page_chars,
      );
      return { ok: true, result: ctx.screenshot };
    }
    case "dom_query": {
      const tab = await activeTab();
      injectableOrThrow(tab);
      const selector = String(args.selector ?? "");
      const limit = Number(args.limit ?? 20);
      if (!selector) return { ok: false, error: "selector required" };
      const [{ result } = { result: null }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: (sel: string, lim: number) => {
          const nodes = Array.from(document.querySelectorAll(sel)).slice(0, lim);
          return nodes.map((n) => ({
            tag: n.tagName.toLowerCase(),
            text: ((n as HTMLElement).innerText || n.textContent || "").trim().slice(0, 2000),
            href: (n as HTMLAnchorElement).href ?? null,
            id: (n as HTMLElement).id || null,
          }));
        },
        args: [selector, limit],
      });
      return { ok: true, result };
    }
    case "list_tabs": {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      return {
        ok: true,
        result: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active })),
      };
    }
    case "open_url": {
      const url = String(args.url ?? "");
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: "url must be http(s)" };
      const tab = await chrome.tabs.create({ url, active: Boolean(args.active ?? false) });
      return { ok: true, result: { tab_id: tab.id, url: tab.url } };
    }
    case "write_clipboard": {
      const text = String(args.text ?? "");
      await ensureOffscreen();
      await chrome.runtime.sendMessage({ target: "offscreen", action: "write_clipboard", text });
      return { ok: true, result: { length: text.length } };
    }
    case "download_url": {
      const url = String(args.url ?? "");
      const filename = args.filename ? String(args.filename) : undefined;
      const id = await chrome.downloads.download({ url, filename, saveAs: true });
      return { ok: true, result: { download_id: id } };
    }
    case "scroll_to": {
      const tab = await activeTab();
      injectableOrThrow(tab);
      const selector = String(args.selector ?? "");
      await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return { found: false };
          (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
          return { found: true };
        },
        args: [selector],
      });
      return { ok: true, result: { selector } };
    }
    case "click": {
      const tab = await activeTab();
      injectableOrThrow(tab);
      const selector = String(args.selector ?? "");
      const [{ result } = { result: null }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: (sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return { ok: false, reason: "not_found" };
          el.click();
          return { ok: true };
        },
        args: [selector],
      });
      return { ok: true, result };
    }
    case "fill_input": {
      const tab = await activeTab();
      injectableOrThrow(tab);
      const selector = String(args.selector ?? "");
      const value = String(args.value ?? "");
      const [{ result } = { result: null }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        func: (sel: string, val: string) => {
          const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
          if (!el) return { ok: false, reason: "not_found" };
          const proto =
            el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          setter?.call(el, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        },
        args: [selector, value],
      });
      return { ok: true, result };
    }
    default:
      return { ok: false, error: `tool "${name}" not implemented` };
  }
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResultPayload> {
  try {
    return await runTool(name, args);
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? String(e) };
  }
}

export function toolNeedsConfirmation(name: string): boolean {
  return TOOL_SPECS.find((s) => s.name === name)?.requires_confirmation ?? false;
}
