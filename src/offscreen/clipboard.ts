type Msg = { target: "offscreen"; action: "write_clipboard"; text: string };

chrome.runtime.onMessage.addListener((msg: Msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  if (msg.action === "write_clipboard") {
    const el = document.getElementById("t") as HTMLTextAreaElement | null;
    if (!el) {
      sendResponse({ ok: false, error: "no textarea" });
      return;
    }
    el.value = msg.text;
    el.select();
    try {
      const ok = document.execCommand("copy");
      sendResponse({ ok });
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message });
    }
    return true;
  }
});
