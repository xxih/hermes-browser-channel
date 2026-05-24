import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Hermes Browser Channel",
  short_name: "Hermes",
  version: pkg.version,
  description:
    "Chat with your Hermes agent from the browser side panel. Attaches page context (URL, title, selection, page text, screenshot) and exposes opt-in tools the agent can call. Every tool call is audited in the chat thread.",
  minimum_chrome_version: "116",

  permissions: [
    "storage",
    "sidePanel",
    "scripting",
    "activeTab",
    "alarms",
    "offscreen",
    "tabs",
    "downloads",
  ],

  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },

  action: {
    default_title: "Open Hermes side panel",
  },

  side_panel: {
    default_path: "src/sidepanel/index.html",
  },

  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },

});
