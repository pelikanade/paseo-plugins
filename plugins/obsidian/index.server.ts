import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installVault } from "./server/install";

export default function contribute(server: PluginServerContext) {
  return installVault(server, {
    dataRoot: process.env.PASEO_HOME
      ? `${process.env.PASEO_HOME}/plugin-data/obsidian`
      : undefined,
    defaultObBinary: "ob",
  });
}
