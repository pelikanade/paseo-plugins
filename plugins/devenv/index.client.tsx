import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { SettingsScreen } from "./client/settings";
import { StatusPanel, StatusPopover } from "./client/status";
import { observeRefresh, refreshStatus } from "./client/refresh";
import { describe } from "./client/presentation";
import { statusIcons } from "./client/status-icon";
import { allowRpc, statusLabel, statusRpc } from "./shared/contracts";

type Agents = PluginClientContext["paseo"]["agents"];
type PaseoAgent = Exclude<Parameters<Agents["ref"]>[0], string>;
type Subscription = NonNullable<
  Awaited<ReturnType<Agents["list"]>>["subscription"]
>;

interface Pill {
  workspaceId: string;
  registration: PluginButtonRegistration;
  timer: ReturnType<typeof setTimeout> | undefined;
  reading: boolean;
}
export default function contribute(client: PluginClientContext) {
  const pills = new Map<string, Pill>();
  const lifetime = { alive: true };
  const isAlive = () => lifetime.alive;
  let subscription: Subscription | undefined;
  const remove = (id: string) => {
    const pill = pills.get(id);
    if (pill) {
      clearTimeout(pill.timer);
      pill.registration.remove();
      pills.delete(id);
    }
  };
  const refresh = async (id: string, attempt = 0) => {
    const pill = pills.get(id);
    if (!pill || pill.reading || !isAlive()) return;
    clearTimeout(pill.timer);
    pill.reading = true;
    try {
      const view = await client.rpc(statusRpc, { agentId: id });
      if (!isAlive() || pills.get(id) !== pill) return;
      pill.registration.update({
        visible: view.root !== null || view.needsReload,
        title: view.root ?? "devenv",
        label: statusLabel(view),
        icon: statusIcons[describe(view).tone],
      });
      if (view.root !== null || view.needsReload)
        pill.timer = setTimeout(
          () => {
            refresh(id, view.status === "loading" ? attempt + 1 : 0).catch(
              console.error,
            );
          },
          view.status === "loading" && attempt < 90 ? 1500 : 5000,
        );
    } finally {
      pill.reading = false;
    }
  };
  const sync = (agent: PaseoAgent) => {
    if (
      pills.get(agent.id)?.workspaceId !== agent.workspaceId ||
      agent.archivedAt
    )
      remove(agent.id);
    if (agent.archivedAt || !agent.workspaceId) return;
    if (!pills.has(agent.id))
      pills.set(agent.id, {
        workspaceId: agent.workspaceId,
        timer: undefined,
        reading: false,
        registration: client.addComposerPill({
          id: "devenv",
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          button: {
            title: "devenv",
            icon: statusIcons.neutral,
            visible: false,
            behavior: { kind: "popover", Content: StatusPopover },
          },
        }),
      });
    refresh(agent.id).catch(console.error);
  };
  const cleanups = [
    client.addSettingsScreen({
      id: "devenv",
      title: "devenv",
      icon: "Leaf",
      Component: SettingsScreen,
    }),
    client.addWorkspacePanel({
      id: "devenv",
      title: "devenv",
      icon: "Leaf",
      context: "agent",
      Component: StatusPanel,
    }),
    client.addSlashCommand({
      name: "devenv-status",
      description: "Inspect project trust and session environment",
      argumentHint: "",
      context: "agent",
      onSubmit: (context) => {
        refreshStatus(context.agent.id);
        context.openPanel("devenv");
      },
    }),
    client.addSlashCommand({
      name: "devenv-allow",
      description:
        "Trust this devenv project and its main repository project, prepare and reload the agent",
      argumentHint: "",
      context: "agent",
      onSubmit: async (context) => {
        await context.rpc(allowRpc, { agentId: context.agent.id });
        refreshStatus(context.agent.id);
        context.openPanel("devenv");
      },
    }),
    observeRefresh((id) => {
      refresh(id).catch(console.error);
    }),
    client.paseo.agents.subscribe((update) => {
      if (update.kind === "upsert") sync(update.agent);
      else remove(update.agentId);
    }),
  ];
  const initialize = async () => {
    const page = await client.paseo.agents.list({
      subscribe: {},
      page: { limit: 200 },
    });
    subscription = page.subscription;
    if (!isAlive()) return;
    cleanups.push(
      subscription.subscribe({
        snapshot: (snapshot) => {
          if (isAlive())
            for (const entry of snapshot.entries) sync(entry.agent);
        },
        update: () => {},
        error: console.error,
      }),
    );
    for (const entry of page.entries) sync(entry.agent);
    let cursor = page.pageInfo.nextCursor;
    while (isAlive() && cursor) {
      const next = await client.paseo.agents.list({
        page: { limit: 200, cursor },
      });
      for (const entry of next.entries) if (isAlive()) sync(entry.agent);
      cursor = next.pageInfo.nextCursor;
    }
  };
  const initialized = initialize().catch(console.error);
  return async () => {
    lifetime.alive = false;
    for (const id of pills.keys()) remove(id);
    for (const cleanup of cleanups) cleanup();
    await initialized;
    await subscription?.release();
  };
}
