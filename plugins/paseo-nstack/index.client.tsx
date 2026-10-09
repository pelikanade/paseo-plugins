import type { PluginClientContext } from "@getpaseo/plugin/client";
import { StartedNotice } from "./client/notice";
import { NstackPanel } from "./client/panel";
import { startedNoticeSchema } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineRenderer({
      kind: "nstack-agent-started",
      version: 1,
      schema: startedNoticeSchema,
      Component: StartedNotice,
    }),
    client.addWorkspacePanel({
      id: "nstack",
      title: "Automatic agents",
      icon: "Bot",
      context: "workspace",
      Component: NstackPanel,
    }),
    client.addCommandCenterItem({
      id: "nstack",
      title: "Automatic agents",
      icon: "Bot",
      keywords: ["nstack", "github", "orchestration"],
      context: "workspace",
      onSelect(context) {
        context.openPanel("nstack");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
