import type { ChatMessage } from "@/lib/storage";

type Props = { msg: Exclude<ChatMessage, { role: "tool" }> };

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ msg }: Props) {
  if (msg.role === "system") {
    const color =
      msg.level === "error"
        ? "text-red-400"
        : msg.level === "warn"
          ? "text-yellow-400"
          : "text-muted";
    return (
      <div className={`text-[11px] italic ${color} px-1`}>· {msg.text}</div>
    );
  }
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[88%] bg-bubbleUser rounded-2xl rounded-br-sm px-3 py-2"
            : "max-w-[92%] bg-bubbleBot border border-border rounded-2xl rounded-bl-sm px-3 py-2"
        }
      >
        <div className="bubble-content text-sm">
          {msg.text}
          {msg.role === "assistant" && msg.streaming ? (
            <span className="inline-block w-2 h-3 align-middle ml-0.5 bg-fg/60 animate-pulse" />
          ) : null}
        </div>
        <div className="text-[10px] text-muted mt-1 flex items-center gap-1">
          <span>{fmtTime(msg.ts)}</span>
          {isUser && msg.has_context ? <span className="text-accent">· ctx</span> : null}
        </div>
      </div>
    </div>
  );
}
