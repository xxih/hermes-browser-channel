import { useCallback, useRef } from "react";
import type { ContextOptions } from "@/lib/protocol";
import { t } from "@/lib/i18n";

type Props = {
  contextOptions: ContextOptions;
  onContextChange: (next: ContextOptions) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  disabledReason?: string;
};

const CHIPS: Array<{ key: keyof ContextOptions; labelKey: string; titleKey: string }> = [
  { key: "url_title", labelKey: "chip_url_label", titleKey: "chip_url_title" },
  { key: "selection", labelKey: "chip_sel_label", titleKey: "chip_sel_title" },
  { key: "page", labelKey: "chip_page_label", titleKey: "chip_page_title" },
  { key: "screenshot", labelKey: "chip_shot_label", titleKey: "chip_shot_title" },
];

export function Composer({ contextOptions, onContextChange, onSend, disabled, disabledReason }: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const submit = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;
    onSend(text);
    ta.value = "";
    ta.style.height = "auto";
  }, [onSend]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }, []);

  const placeholder = disabled
    ? t("composer_placeholder_disabled", disabledReason ?? "—")
    : t("composer_placeholder");

  return (
    <div className="border-t border-border p-2 bg-bg">
      <div className="flex flex-wrap gap-1 mb-2">
        {CHIPS.map((c) => {
          const on = contextOptions[c.key];
          return (
            <button
              key={c.key}
              title={t(c.titleKey)}
              onClick={() => onContextChange({ ...contextOptions, [c.key]: !on })}
              className={
                "text-[11px] px-2 py-0.5 rounded-full border transition-colors " +
                (on
                  ? "bg-accent/15 text-accent border-accent/40"
                  : "bg-transparent text-muted border-border hover:text-fg")
              }
            >
              {t(c.labelKey)}
            </button>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={taRef}
          rows={1}
          placeholder={placeholder}
          className="flex-1 resize-none bg-bubbleBot text-fg border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent text-sm min-h-[32px] max-h-[220px]"
          onKeyDown={onKeyDown}
          onInput={onInput}
          disabled={disabled}
        />
        <button
          onClick={submit}
          disabled={disabled}
          className={
            "shrink-0 h-[32px] px-3 rounded-md text-sm font-semibold " +
            (disabled
              ? "bg-border text-muted cursor-not-allowed"
              : "bg-accent text-bg hover:opacity-90")
          }
        >
          {t("composer_send")}
        </button>
      </div>
    </div>
  );
}
