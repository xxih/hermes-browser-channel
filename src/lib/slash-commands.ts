export type SlashCommand = {
  name: string;
  description: string;
  subcommands?: string[];
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "/new", description: "Start a new session (fresh session ID + history)" },
  { name: "/reset", description: "Start a new session (alias for /new)" },
  { name: "/clear", description: "Clear screen and start a new session" },
  { name: "/history", description: "Show conversation history" },
  { name: "/save", description: "Save the current conversation" },
  { name: "/retry", description: "Retry the last message (resend to agent)" },
  { name: "/undo", description: "Remove the last user/assistant exchange" },
  { name: "/title", description: "Set a title for the current session" },
  { name: "/handoff", description: "Hand off this session to a messaging platform" },
  { name: "/branch", description: "Branch the current session (explore a different path)" },
  { name: "/compress", description: "Manually compress conversation context" },
  { name: "/rollback", description: "List or restore filesystem checkpoints" },
  { name: "/snapshot", description: "Create or restore state snapshots", subcommands: ["create", "restore"] },
  { name: "/stop", description: "Kill all running background processes" },
  { name: "/background", description: "Run a prompt in the background" },
  { name: "/agents", description: "Show active agents and running tasks" },
  { name: "/queue", description: "Queue a prompt for the next turn" },
  { name: "/steer", description: "Inject a message after the next tool call" },
  { name: "/goal", description: "Set a standing goal across turns" },
  { name: "/subgoal", description: "Add or manage extra criteria on the active goal" },
  { name: "/status", description: "Show session info" },
  { name: "/whoami", description: "Show your slash command access" },
  { name: "/profile", description: "Show active profile name and home directory" },
  { name: "/resume", description: "Resume a previously-named session" },
  { name: "/sessions", description: "Browse and resume previous sessions" },
  { name: "/config", description: "Show current configuration" },
  { name: "/model", description: "Switch model for this session" },
  { name: "/personality", description: "Set a predefined personality" },
  { name: "/statusbar", description: "Toggle the context/model status bar" },
  { name: "/verbose", description: "Cycle tool progress display" },
  { name: "/footer", description: "Toggle runtime-metadata footer", subcommands: ["on", "off", "status"] },
  { name: "/yolo", description: "Toggle YOLO mode (skip all dangerous command approvals)" },
  { name: "/reasoning", description: "Manage reasoning effort and display", subcommands: ["none", "minimal", "low", "medium", "high", "show", "hide"] },
  { name: "/fast", description: "Toggle fast mode (Priority Processing)", subcommands: ["normal", "fast", "status"] },
  { name: "/skin", description: "Show or change the display skin/theme" },
  { name: "/indicator", description: "Pick the busy-indicator style", subcommands: ["kaomoji", "emoji", "unicode", "ascii"] },
  { name: "/voice", description: "Toggle voice mode", subcommands: ["on", "off", "tts", "status"] },
  { name: "/busy", description: "Control what Enter does while Hermes is working", subcommands: ["queue", "steer", "interrupt", "status"] },
  { name: "/tools", description: "Manage tools", subcommands: ["list", "disable", "enable"] },
  { name: "/toolsets", description: "List available toolsets" },
  { name: "/skills", description: "Search, install, inspect, or manage skills", subcommands: ["search", "browse", "inspect", "install"] },
  { name: "/bundles", description: "List skill bundles" },
  { name: "/cron", description: "Manage scheduled tasks", subcommands: ["list", "add", "create", "edit", "pause", "resume", "run", "remove"] },
  { name: "/curator", description: "Background skill maintenance", subcommands: ["status", "run", "pause", "resume", "pin", "unpin", "restore", "list-archived"] },
  { name: "/kanban", description: "Multi-profile collaboration board" },
  { name: "/reload", description: "Reload .env variables into the running session" },
  { name: "/browser", description: "Connect browser tools via CDP", subcommands: ["connect", "disconnect", "status"] },
  { name: "/plugins", description: "List installed plugins and their status" },
  { name: "/help", description: "Show available commands" },
  { name: "/usage", description: "Show token usage and rate limits" },
  { name: "/insights", description: "Show usage insights and analytics" },
  { name: "/platforms", description: "Show gateway/messaging platform status" },
  { name: "/copy", description: "Copy the last assistant response to clipboard" },
  { name: "/paste", description: "Attach clipboard image from your clipboard" },
  { name: "/image", description: "Attach a local image file for your next prompt" },
  { name: "/debug", description: "Upload debug report and get shareable links" },
  // Gateway-side commands not in the CLI registry but commonly used in chat
  { name: "/sethome", description: "Set this chat as your home channel for cron / notifications" },
  { name: "/approve", description: "Approve the pending dangerous command (this time)", subcommands: ["session", "always"] },
  { name: "/deny", description: "Deny the pending dangerous command" },
];

export function filterSlashCommands(input: string): SlashCommand[] {
  // input includes the leading "/"
  if (!input.startsWith("/")) return [];
  const lower = input.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(lower) && c.name !== lower).slice(0, 8);
}

export function expandSubcommands(input: string): SlashCommand[] {
  // input has shape "/cmd " or "/cmd sub"
  const m = input.match(/^(\/[a-z_-]+)\s+(\S*)$/i);
  if (!m) return [];
  const base = SLASH_COMMANDS.find((c) => c.name === m[1].toLowerCase());
  if (!base || !base.subcommands) return [];
  const partial = m[2].toLowerCase();
  return base.subcommands
    .filter((s) => s.startsWith(partial))
    .slice(0, 8)
    .map((s) => ({ name: `${base.name} ${s}`, description: `${base.name} → ${s}` }));
}
