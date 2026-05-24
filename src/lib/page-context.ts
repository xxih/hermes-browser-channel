import type { ContextOptions, PageContext } from "./protocol";

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

function isInjectable(url: string | undefined): boolean {
  if (!url) return false;
  return !(
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:") ||
    url === "chrome://newtab/"
  );
}

type ExtractResult = {
  selection: string;
  page_text: string;
  excerpt: string;
  truncated: boolean;
};

function extractInPage(maxChars: number): ExtractResult {
  const sel = window.getSelection?.()?.toString().trim() ?? "";

  const collectFrom = (root: Element | null): string => {
    if (!root) return "";
    const clone = root.cloneNode(true) as Element;
    clone.querySelectorAll("script, style, nav, header, footer, aside, noscript, iframe, svg").forEach((n) => n.remove());
    const text = (clone as HTMLElement).innerText || "";
    return text.replace(/\n{3,}/g, "\n\n").trim();
  };

  let text = collectFrom(document.querySelector("article") ?? document.querySelector("main"));
  if (text.length < 200) {
    text = collectFrom(document.body);
  }

  const truncated = text.length > maxChars;
  const page_text = truncated ? text.slice(0, maxChars) : text;

  const metaDesc =
    (document.querySelector('meta[name="description"]') as HTMLMetaElement | null)?.content ??
    (document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null)?.content ??
    "";
  const excerpt = (metaDesc || page_text.slice(0, 280)).trim();

  return { selection: sel, page_text, excerpt, truncated };
}

export async function capturePageContext(opts: ContextOptions, maxPageChars: number): Promise<PageContext> {
  const tab = await activeTab();
  if (!tab) throw new Error("no active tab");

  const url = tab.url ?? "";
  const title = tab.title ?? "";
  const ctx: PageContext = {
    url: opts.url_title ? url : "",
    title: opts.url_title ? title : "",
    captured_at: Date.now(),
  };

  const needsScripting = opts.selection || opts.page;
  if (needsScripting) {
    if (!tab.id || !isInjectable(url)) {
      throw new Error(`cannot read this page (${url || "unknown URL"})`);
    }
    const [{ result } = { result: null }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractInPage,
      args: [maxPageChars],
    });
    const r = result as ExtractResult | null;
    if (r) {
      if (opts.selection && r.selection) ctx.selection = r.selection;
      if (opts.page) {
        ctx.page = {
          excerpt: r.excerpt || undefined,
          content_text: r.page_text,
          length: r.page_text.length,
          truncated: r.truncated,
        };
      }
    }
  }

  if (opts.screenshot) {
    if (!tab.windowId) throw new Error("no active window for screenshot");
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
    const b64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    ctx.screenshot = { mime: "image/jpeg", data_base64: b64 };
  }

  return ctx;
}
