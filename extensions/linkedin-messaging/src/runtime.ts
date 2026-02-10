import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setLinkedInRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getLinkedInRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("LinkedIn runtime not initialized");
  }
  return runtime;
}
