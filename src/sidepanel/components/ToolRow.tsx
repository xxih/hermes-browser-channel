import type { ChatMessage } from "@/lib/storage";
import { t } from "@/lib/i18n";

type ToolMsg = Extract<ChatMessage, { role: "tool" }>;

type Props = {
  msg: ToolMsg;
  onConfirm: (call_id: string, approved: boolean) => void;
};

function fmtArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      let s = typeof v === "string" ? v : JSON.stringify(v);
      if (s.length > 80) s = s.slice(0, 77) + "…";
      return `${k}=${s}`;
    })
    .join(", ");
}

export function ToolRow({ msg, onConfirm }: Props) {
  const stateColor =
    msg.state === "ok"
      ? "text-emerald-400"
      : msg.state === "error"
        ? "text-red-400"
        : msg.state === "denied"
          ? "text-muted line-through"
          : msg.state === "running"
            ? "text-yellow-400"
            : "text-accent";

  return (
    <div className="text-[11px] text-muted border border-border bg-bubbleBot/40 rounded-md px-2 py-1.5">
      <div className="flex items-baseline gap-1">
        <span className="text-muted">{t("tool_label")}</span>
        <span className={`font-mono ${stateColor}`}>{msg.tool}</span>
        <span className="text-muted truncate">({fmtArgs(msg.args)})</span>
        <span className={`ml-auto ${stateColor}`}>
          {msg.state === "ok"
            ? `${t("tool_state_ok_prefix")}${msg.summary ?? "ok"}`
            : msg.state === "error"
              ? `${t("tool_state_error_prefix")}${msg.error}`
              : msg.state === "denied"
                ? t("tool_state_denied")
                : msg.state === "running"
                  ? t("tool_state_running")
                  : t("tool_state_pending")}
        </span>
      </div>
      {msg.state === "pending" ? (
        <div className="mt-1 flex gap-2">
          <button
            className="px-2 py-0.5 rounded bg-accent text-bg text-[11px] font-semibold"
            onClick={() => onConfirm(msg.call_id, true)}
          >
            {t("tool_run")}
          </button>
          <button
            className="px-2 py-0.5 rounded border border-border text-[11px]"
            onClick={() => onConfirm(msg.call_id, false)}
          >
            {t("tool_deny")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
