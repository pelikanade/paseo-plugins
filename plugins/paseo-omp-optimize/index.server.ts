import type { PluginServerContext } from "@getpaseo/plugin/server";
import { contributeIntent } from "./server/intent";
import contributeReadImage from "./server/read-image";

export default function contribute(server: PluginServerContext) {
  const cleanups = [contributeReadImage(server), contributeIntent(server)];
  return async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  };
}
