import type { ConnectionState } from "@/lib/messages";
import { t } from "@/lib/i18n";

const KEYS: Record<ConnectionState, string> = {
  idle: "conn_idle",
  connecting: "conn_connecting",
  open: "conn_open",
  closed: "conn_closed",
  error: "conn_error",
};

const COLORS: Record<ConnectionState, string> = {
  idle: "bg-muted",
  connecting: "bg-yellow-500 animate-pulse",
  open: "bg-emerald-500",
  closed: "bg-muted",
  error: "bg-red-500",
};

type Props = {
  state: ConnectionState;
  detail?: string;
  onReconnect: () => void;
  onSettings: () => void;
  onClear: () => void;
};

export function ConnectionBar({ state, detail, onReconnect, onSettings, onClear }: Props) {
  return (
    <div className="border-b border-border px-3 py-2 flex items-center gap-2 bg-bg/80 backdrop-blur">
      <span className={`w-2 h-2 rounded-full ${COLORS[state]}`} aria-hidden />
      <div className="flex flex-col leading-tight">
        <span className="text-fg font-semibold text-xs">Hermes</span>
        <span className="text-muted text-[10px]">
          {t(KEYS[state])}
          {detail ? ` · ${detail}` : ""}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          className="text-xs text-muted hover:text-fg px-2 py-1 rounded"
          onClick={onReconnect}
          title={t("bar_reconnect")}
        >
          ↻
        </button>
        <button
          className="text-xs text-muted hover:text-fg px-2 py-1 rounded"
          onClick={onSettings}
          title={t("bar_settings")}
        >
          ⚙
        </button>
        <button
          className="text-xs text-muted hover:text-fg px-2 py-1 rounded"
          onClick={onClear}
          title={t("bar_clear")}
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
