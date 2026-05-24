import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "__MSG_extName__",
  short_name: "__MSG_extShortName__",
  version: pkg.version,
  description: "__MSG_extDescription__",
  default_locale: "en",
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
    default_title: "__MSG_actionTitle__",
  },

  side_panel: {
    default_path: "src/sidepanel/index.html",
  },

  options_ui: {
    page: "src/options/index.html",
    open_in_tab: true,
  },

});
