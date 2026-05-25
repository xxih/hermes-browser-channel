import type { SlashCommand } from "@/lib/slash-commands";

type Props = {
  items: SlashCommand[];
  selectedIndex: number;
  onPick: (cmd: SlashCommand) => void;
  onHover: (idx: number) => void;
};

export function SlashHints({ items, selectedIndex, onPick, onHover }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 bg-bubbleBot border border-border rounded-md shadow-lg overflow-hidden max-h-72 overflow-y-auto z-10">
      {items.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(cmd)}
          className={
            "w-full text-left px-2.5 py-1.5 flex items-baseline gap-2 text-xs transition-colors " +
            (i === selectedIndex ? "bg-accent/15" : "hover:bg-border/30")
          }
        >
          <span className="font-mono text-accent shrink-0">{cmd.name}</span>
          <span className="text-muted text-[11px] truncate">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}
