import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CardsPanel } from "./client/panel";
import { CardRow, InlineRow } from "./client/renderer";
import { inlineSchema, transformer } from "./client/timeline";
import { cardSchema } from "./shared/protocol";
import { guideRpc } from "./shared/contracts";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineTransformer(transformer),
    client.addTimelineRenderer({
      kind: "inline",
      version: 1,
      schema: inlineSchema,
      Component: InlineRow,
    }),
    client.addTimelineRenderer({
      kind: "card",
      version: 1,
      schema: cardSchema,
      Component: CardRow,
    }),
    client.addWorkspacePanel({
      id: "cards",
      title: "Generative UI",
      icon: "PanelsTopLeft",
      context: "agent",
      Component: CardsPanel,
    }),
    client.addSlashCommand({
      name: "ui",
      description: "Use native generative UI in this conversation",
      argumentHint: "what to present",
      context: "agent",
      async onSubmit(context) {
        const { text } = await context.rpc(guideRpc, {});
        await context.paseo.agents
          .ref(context.agent.id)
          .send(
            `${text}\n\nUse the inline protocol above to present: ${context.args || "the current task"}`,
          );
      },
    }),
    client.addCommandCenterItem({
      id: "cards",
      title: "Generative UI cards",
      icon: "PanelsTopLeft",
      context: "agent",
      onSelect(context) {
        context.openPanel("cards");
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
