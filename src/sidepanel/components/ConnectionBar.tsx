import type { ConnectionState } from "@/lib/messages";

const LABELS: Record<ConnectionState, string> = {
  idle: "idle",
  connecting: "connecting…",
  open: "connected",
  closed: "disconnected",
  error: "error",
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
          {LABELS[state]}
          {detail ? ` · ${detail}` : ""}
        </span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          className="text-xs text-muted hover:text-fg px-2 py-1 rounded"
          onClick={onReconnect}
          title="Reconnect"
        >
          ↻
        </button>
        <button
          className="text-xs text-muted hover:text-fg px-2 py-1 rounded"
          onClick={onSettings}
          title="Settings"
        >
          ⚙
        </button>
        <button
          className="text-xs text-muted hover:text-fg px-2 py-1 rounded"
          onClick={onClear}
          title="Clear history"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
