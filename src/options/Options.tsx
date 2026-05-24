import { useCallback, useEffect, useState } from "react";
import { type Settings, loadSettings, saveSettings } from "@/lib/storage";
import { TOOL_SPECS, defaultToolPolicy } from "@/lib/tools";
import { t } from "@/lib/i18n";

const DEFAULT_CTX_KEYS: Array<{ key: "url_title" | "selection" | "page" | "screenshot"; labelKey: string }> = [
  { key: "url_title", labelKey: "opt_default_url_title" },
  { key: "selection", labelKey: "opt_default_selection" },
  { key: "page", labelKey: "opt_default_page" },
  { key: "screenshot", labelKey: "opt_default_screenshot" },
];

const TRUST_LABEL_KEYS: Record<"read" | "light_write" | "write", string> = {
  read: "opt_tool_group_read",
  light_write: "opt_tool_group_light_write",
  write: "opt_tool_group_write",
};

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
    return <div className="p-6 text-muted">{t("opt_loading")}</div>;
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
        <h1 className="text-xl font-semibold">{t("opt_h1")}</h1>
        <p className="text-muted text-xs mt-1">{t("opt_h1_sub")}</p>
      </header>

      <section className="border border-border rounded-lg p-4 space-y-3">
        <h2 className="text-base font-semibold">{t("opt_section_endpoint")}</h2>
        <label className="block">
          <span className="text-muted text-xs">{t("opt_endpoint_label")}</span>
          <input
            type="text"
            spellCheck={false}
            placeholder={t("opt_endpoint_placeholder")}
            className="mt-1 w-full bg-bubbleBot border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent font-mono text-xs"
            value={settings.endpoint}
            onChange={(e) => void update({ endpoint: e.target.value.trim() })}
          />
        </label>
        <label className="block">
          <span className="text-muted text-xs">{t("opt_token_label")}</span>
          <input
            type="password"
            spellCheck={false}
            className="mt-1 w-full bg-bubbleBot border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent font-mono text-xs"
            value={settings.token}
            onChange={(e) => void update({ token: e.target.value })}
          />
        </label>
        <div className="text-[11px] text-muted">
          {t("opt_client_id_label")} <code>{settings.client_id || t("opt_client_id_pending")}</code>
        </div>
      </section>

      <section className="border border-border rounded-lg p-4 space-y-3">
        <h2 className="text-base font-semibold">{t("opt_section_default_context")}</h2>
        <p className="text-muted text-xs">{t("opt_section_default_context_hint")}</p>
        <div className="flex flex-wrap gap-3">
          {DEFAULT_CTX_KEYS.map(({ key, labelKey }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.default_context[key]}
                onChange={(e) =>
                  void update({
                    default_context: { ...settings.default_context, [key]: e.target.checked },
                  })
                }
              />
              <span>{t(labelKey)}</span>
            </label>
          ))}
        </div>
        <label className="block">
          <span className="text-muted text-xs">{t("opt_max_page_label")}</span>
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
          <h2 className="text-base font-semibold">{t("opt_section_tools")}</h2>
          <p className="text-muted text-xs mt-1">{t("opt_section_tools_hint")}</p>
        </div>

        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.auto_confirm_writes}
            onChange={(e) => void update({ auto_confirm_writes: e.target.checked })}
          />
          {t("opt_auto_confirm")}
        </label>

        {(["read", "light_write", "write"] as const).map((trust) => (
          <div key={trust} className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted">
              {t(TRUST_LABEL_KEYS[trust])}
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
                        <span className="ml-1 text-[10px] text-yellow-400">{t("opt_tool_confirm_badge")}</span>
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
        {savedAt ? t("opt_saved_at", new Date(savedAt).toLocaleTimeString()) : t("opt_save_hint_default")}
      </footer>
    </div>
  );
}
