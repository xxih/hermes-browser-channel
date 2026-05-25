import { useCallback, useMemo, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ContextOptions } from "@/lib/protocol";
import { t } from "@/lib/i18n";
import { type SlashCommand, expandSubcommands, filterSlashCommands } from "@/lib/slash-commands";
import { SlashHints } from "./SlashHints";

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
  const [value, setValue] = useState("");
  const [hintIndex, setHintIndex] = useState(0);

  const slashHints: SlashCommand[] = useMemo(() => {
    if (!value.startsWith("/")) return [];
    if (/\s/.test(value)) return expandSubcommands(value);
    return filterSlashCommands(value);
  }, [value]);

  const hintsVisible = slashHints.length > 0;

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    setHintIndex(0);
    const ta = taRef.current;
    if (ta) ta.style.height = "auto";
  }, [onSend, value]);

  const applyHint = useCallback((cmd: SlashCommand) => {
    const replaced = cmd.subcommands && cmd.subcommands.length > 0 ? `${cmd.name} ` : cmd.name;
    setValue(replaced);
    setHintIndex(0);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(replaced.length, replaced.length);
      }
    });
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (hintsVisible) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHintIndex((i) => Math.min(i + 1, slashHints.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHintIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          applyHint(slashHints[hintIndex] ?? slashHints[0]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setValue("");
          return;
        }
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          // If user typed an exact command, send; otherwise apply selected hint
          const exactMatch = slashHints.find((c) => c.name === value.trim());
          if (exactMatch && !exactMatch.subcommands) {
            submit();
          } else {
            applyHint(slashHints[hintIndex] ?? slashHints[0]);
          }
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        submit();
      }
    },
    [hintsVisible, slashHints, hintIndex, applyHint, submit, value],
  );

  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    setValue(ta.value);
    setHintIndex(0);
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
      <div className="flex items-end gap-2 relative">
        <div className="flex-1 relative">
          <SlashHints
            items={slashHints}
            selectedIndex={hintIndex}
            onPick={applyHint}
            onHover={setHintIndex}
          />
          <textarea
            ref={taRef}
            rows={1}
            value={value}
            placeholder={placeholder}
            className="w-full resize-none bg-bubbleBot text-fg border border-border rounded-md px-2 py-1.5 outline-none focus:border-accent text-sm min-h-[32px] max-h-[220px]"
            onKeyDown={onKeyDown}
            onInput={onInput}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
          />
        </div>
        <button
          onClick={submit}
          disabled={disabled}
          aria-label={t("composer_send")}
          title={t("composer_send")}
          className={
            "shrink-0 h-[32px] w-[32px] flex items-center justify-center rounded-md transition-colors " +
            (disabled
              ? "bg-border text-muted cursor-not-allowed"
              : "bg-accent text-bg hover:opacity-90")
          }
        >
          <Send size={14} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}
