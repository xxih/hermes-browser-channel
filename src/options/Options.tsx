import { useCallback, useEffect, useState } from "react";
import { type Settings, loadSettings, saveSettings } from "@/lib/storage";
import { TOOL_SPECS, defaultToolPolicy } from "@/lib/tools";

export function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch);
    setSettings(next);
    setSavedAt(Date.now());
  }, []);

  if (!settings) {
    return <div className="p-6 text-muted">Loading…</div>;
  }

  const policy = settings.tool_policy ?? defaultToolPolicy();

  const grouped: Record<string, typeof TOOL_SPECS> = {
    read: [],
    light_write: [],
    write: [],
  };
  for (const spec of TOOL_SPECS) grouped[spec.trust].push(spec);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6 text-sm">
      <header>
        <h1 className="text-xl font-semibold">Hermes Browser Channel</h1>
        <p className="text-muted text-xs mt-1">
          Connect your browser to your Hermes agent. Read-only by default; opt in to write tools as you trust them.
        </p>
      </header>

      <section className="border border-border rounded-lg p-4 space-y-3">
        <h2 className="text-base font-semibold">Endpoint</h2>
        <label className="block">
          <span className="text-muted text-xs">WebSocket URL</span>
          <input
            type="text"
            spellCheck={false}
            placeholder="wss://hermes.example.com/ws/browser"
            className="mt-1 w-full bg-bubbleBot border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent font-mono text-xs"
            value={settings.endpoint}
            onChange={(e) => void update({ endpoint: e.target.value.trim() })}
          />
        </label>
        <label className="block">
          <span className="text-muted text-xs">Link token (sent as <code>?token=…</code>)</span>
          <input
            type="password"
            spellCheck={false}
            className="mt-1 w-full bg-bubbleBot border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent font-mono text-xs"
            value={settings.token}
            onChange={(e) => void update({ token: e.target.value })}
          />
        </label>
        <div className="text-[11px] text-muted">
          client_id: <code>{settings.client_id || "(will be generated on first connect)"}</code>
        </div>
      </section>

      <section className="border border-border rounded-lg p-4 space-y-3">
        <h2 className="text-base font-semibold">Default context to attach</h2>
        <p className="text-muted text-xs">Selected when you open the side panel. You can toggle per message.</p>
        <div className="flex flex-wrap gap-3">
          {(["url_title", "selection", "page", "screenshot"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.default_context[k]}
                onChange={(e) =>
                  void update({
                    default_context: { ...settings.default_context, [k]: e.target.checked },
                  })
                }
              />
              <span className="capitalize">{k.replace("_", " ")}</span>
            </label>
          ))}
        </div>
        <label className="block">
          <span className="text-muted text-xs">Max page text length (characters)</span>
          <input
            type="number"
            min={500}
            max={200000}
            step={500}
            className="mt-1 w-32 bg-bubbleBot border border-border rounded-md px-2 py-1 outline-none focus:border-accent text-xs"
            value={settings.max_page_chars}
            onChange={(e) => void update({ max_page_chars: Number(e.target.value) || 20000 })}
          />
        </label>
      </section>

      <section className="border border-border rounded-lg p-4 space-y-4">
        <div>
          <h2 className="text-base font-semibold">Tools the agent can call</h2>
          <p className="text-muted text-xs mt-1">
            Toggle on the capabilities you want the agent to have. Write tools always show in the chat as an audit row.
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.auto_confirm_writes}
            onChange={(e) => void update({ auto_confirm_writes: e.target.checked })}
          />
          Auto-confirm write tools (skip the Run/Deny prompt)
        </label>

        {(["read", "light_write", "write"] as const).map((trust) => (
          <div key={trust} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted">
              {trust === "read" ? "Read" : trust === "light_write" ? "Light write" : "Write"}
            </h3>
            <div className="space-y-1.5">
              {grouped[trust].map((spec) => (
                <label key={spec.name} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={policy[spec.name]?.enabled ?? spec.default_enabled}
                    onChange={(e) => {
                      const nextPolicy = { ...policy, [spec.name]: { enabled: e.target.checked } };
                      void update({ tool_policy: nextPolicy });
                    }}
                  />
                  <div>
                    <div className="font-mono text-xs">
                      {spec.name}
                      {spec.requires_confirmation ? (
                        <span className="ml-1 text-[10px] text-yellow-400">[confirm]</span>
                      ) : null}
                    </div>
                    <div className="text-[11px] text-muted">{spec.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>

      <footer className="text-xs text-muted">
        {savedAt ? `Saved at ${new Date(savedAt).toLocaleTimeString()}` : "Changes save automatically."}
      </footer>
    </div>
  );
}
