import { t } from "@/lib/i18n";

export function TypingIndicator() {
  return (
    <div className="flex justify-start" role="status" aria-label={t("typing_aria")}>
      <div className="bg-bubbleBot border border-border rounded-2xl rounded-bl-sm px-3 py-2 inline-flex items-center gap-1.5">
        <span
          className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
          style={{ animationDelay: "0ms", animationDuration: "1s" }}
        />
        <span
          className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
          style={{ animationDelay: "150ms", animationDuration: "1s" }}
        />
        <span
          className="w-1.5 h-1.5 bg-muted rounded-full animate-bounce"
          style={{ animationDelay: "300ms", animationDuration: "1s" }}
        />
        <span className="text-[10px] text-muted ml-1">{t("typing_label")}</span>
      </div>
    </div>
  );
}
