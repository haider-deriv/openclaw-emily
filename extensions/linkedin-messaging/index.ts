import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { linkedInMessagingPlugin } from "./src/channel.js";
import { setLinkedInRuntime } from "./src/runtime.js";

const plugin = {
  id: "linkedin",
  name: "LinkedIn",
  description: "LinkedIn messaging channel plugin using Unipile API",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setLinkedInRuntime(api.runtime);
    api.registerChannel({ plugin: linkedInMessagingPlugin });
  },
};

export default plugin;
