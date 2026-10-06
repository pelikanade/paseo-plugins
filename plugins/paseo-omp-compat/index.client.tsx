import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SettingsScreen } from "./client/settings";
import { StatusPanel } from "./client/status";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addSettingsScreen({
      id: "paseo-omp-compat",
      title: "Paseo first",
      icon: "Compass",
      Component: SettingsScreen,
    }),
    client.addWorkspacePanel({
      id: "paseo-first",
      title: "Paseo first",
      icon: "Compass",
      context: "agent",
      Component: StatusPanel,
    }),
    client.addSlashCommand({
      name: "paseo-first",
      description:
        "Show whether the Paseo first directive is active for this agent and its text source",
      argumentHint: "",
      context: "agent",
      onSubmit: (context) => {
        context.openPanel("paseo-first");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
