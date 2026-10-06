import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LoopPanel } from "./client/panel";
import { noticeSchema, NoticeRow } from "./client/notice";
import { armRpc, stopRpc } from "./shared/contracts";
import { dynamicRequest, immediateText } from "./shared/messages";
import { parseLoop, usageText } from "./shared/parse";

type AgentHandle = ReturnType<PluginClientContext["paseo"]["agents"]["ref"]>;

async function notify(agent: AgentHandle, text: string) {
  await agent.timeline.append({
    type: "plugin",
    id: `loop-notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "notice",
    version: 1,
    data: { text },
  });
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineRenderer({
      kind: "notice",
      version: 1,
      schema: noticeSchema,
      Component: NoticeRow,
    }),
    client.addWorkspacePanel({
      id: "loop",
      title: "Loop",
      icon: "Repeat",
      context: "agent",
      Component: LoopPanel,
    }),
    client.addCommandCenterItem({
      id: "loop",
      title: "Loop schedule",
      icon: "Repeat",
      keywords: ["loop", "schedule", "interval"],
      context: "agent",
      onSelect(context) {
        context.openPanel("loop");
      },
    }),
    client.addSlashCommand({
      name: "loop",
      description: "Re-run a prompt on a local schedule until you stop it",
      argumentHint: "[interval] <prompt>",
      context: "agent",
      async onSubmit(context) {
        const agent = context.paseo.agents.ref(context.agent.id);
        const parsed = parseLoop(context.args);
        switch (parsed.type) {
          case "usage":
            await notify(agent, usageText);
            return;
          case "invalid":
            await notify(agent, parsed.message);
            return;
          case "stop":
            await context.rpc(stopRpc, { agentId: context.agent.id });
            await notify(agent, "Loop stopped.");
            return;
          case "dynamic":
            try {
              await agent.send(dynamicRequest(parsed.prompt));
            } catch (error) {
              await notify(
                agent,
                error instanceof Error
                  ? error.message
                  : "Could not start the loop",
              );
            }
            return;
          case "fixed":
            try {
              await context.rpc(armRpc, {
                agentId: context.agent.id,
                prompt: parsed.prompt,
                purpose: parsed.purpose,
                mode: "fixed",
                everySeconds: parsed.everySeconds,
              });
              await agent.send(
                immediateText({
                  everySeconds: parsed.everySeconds,
                  purpose: parsed.purpose,
                  prompt: parsed.prompt,
                }),
              );
            } catch (error) {
              await notify(
                agent,
                error instanceof Error
                  ? error.message
                  : "Could not arm the loop",
              );
            }
            return;
          default: {
            const unreachable: never = parsed;
            return unreachable;
          }
        }
      },
    }),
  ];
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
