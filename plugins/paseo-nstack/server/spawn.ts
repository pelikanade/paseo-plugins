import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PaseoAgent, PaseoAgentHandle, PaseoApi } from "@getpaseo/client";
import type {
  Binding,
  PluginDefaults,
  ProviderChoice,
} from "../shared/contracts";
import { skillFiles } from "./skills.generated";
import type { Launch } from "./state";

export interface StartedAgent {
  agentId: string;
  timelineError: string | null;
}
export interface ProviderOption {
  provider: string;
  model: string | null;
  label: string;
  supportsFullAccess: boolean;
}

export class LaunchConfigurationError extends Error {}

export interface Starter {
  materializeSkills(): Promise<string>;
  providerOptions(paseo: PaseoApi): Promise<ProviderOption[]>;
  validate(paseo: PaseoApi, choice: ProviderChoice): Promise<string>;
  reconcile(
    paseo: PaseoApi,
    binding: Binding,
    launch: Launch,
  ): Promise<StartedAgent | null>;
  start(
    paseo: PaseoApi,
    binding: Binding,
    defaults: PluginDefaults,
    launch: Launch,
  ): Promise<StartedAgent>;
}

function stableAgentId(key: string) {
  const bytes = Buffer.from(
    createHash("sha256").update(key).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function providerSelector(choice: ProviderChoice) {
  return choice.model ? `${choice.provider}/${choice.model}` : choice.provider;
}

export function launchIdentity(workspaceId: string, signalKey: string) {
  const idempotencyKey = `paseo-nstack:${workspaceId}:${signalKey}`;
  return { agentId: stableAgentId(idempotencyKey), idempotencyKey };
}

export function createStarter(directory: string): Starter {
  const skillRoot = join(directory, "skills");
  let materialized: Promise<string> | undefined;

  async function materializeSkills() {
    const request =
      materialized ??
      (async () => {
        await Promise.all(
          Object.entries(skillFiles).map(async ([relativePath, content]) => {
            const path = join(skillRoot, relativePath);
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(path, content, { mode: 0o600 });
          }),
        );
        return skillRoot;
      })();
    materialized = request;
    try {
      return await request;
    } catch (error) {
      if (materialized === request) materialized = undefined;
      throw error;
    }
  }

  async function providerConfigurations(paseo: PaseoApi) {
    const snapshot = await paseo.providers.waitForReady();
    const configurations = await Promise.all(
      snapshot.entries
        .filter((entry) => entry.enabled && entry.status === "ready")
        .map(async (entry) => {
          const modes = await paseo.providers.listModes(entry.provider);
          if (modes.error) throw new Error(modes.error);
          const modeId = modes.modes?.find(
            (mode) =>
              mode.id === "full" ||
              (entry.provider === "opencode" && mode.id === "build"),
          )?.id;
          const featureValues =
            entry.provider === "opencode" ? { auto_accept: true } : undefined;
          const models = entry.models?.filter(
            (model) => model.isSelectable !== false,
          );
          if (!models || models.length === 0)
            return [
              {
                provider: entry.provider,
                model: null,
                label: entry.provider,
                supportsFullAccess: modeId !== undefined,
                modeId,
                featureValues,
              },
            ];
          return models.map((model) => ({
            provider: entry.provider,
            model: model.id,
            label: `${entry.provider} · ${model.label}`,
            supportsFullAccess: modeId !== undefined,
            modeId,
            featureValues,
          }));
        }),
    );
    return configurations.flat();
  }

  async function providerOptions(paseo: PaseoApi) {
    return (await providerConfigurations(paseo)).map((configuration) => ({
      provider: configuration.provider,
      model: configuration.model,
      label: configuration.label,
      supportsFullAccess: configuration.supportsFullAccess,
    }));
  }

  async function resolveChoice(paseo: PaseoApi, choice: ProviderChoice) {
    const configuration = (await providerConfigurations(paseo)).find(
      (option) =>
        option.provider === choice.provider && option.model === choice.model,
    );
    if (!configuration)
      throw new LaunchConfigurationError(
        `Provider/model ${providerSelector(choice)} is unavailable`,
      );
    if (!configuration.modeId)
      throw new LaunchConfigurationError(
        `Provider ${choice.provider} has no full-access mode`,
      );
    return {
      modeId: configuration.modeId,
      featureValues: configuration.featureValues,
      selector: providerSelector(choice),
    };
  }

  async function validate(paseo: PaseoApi, choice: ProviderChoice) {
    return (await resolveChoice(paseo, choice)).selector;
  }

  function notice(binding: Binding, launch: Launch) {
    return {
      type: "plugin" as const,
      id: `nstack-started-${launch.agentId}`,
      kind: "nstack-agent-started",
      version: 1,
      data: {
        workspaceId: binding.workspaceId,
        repository: `${binding.repository.owner}/${binding.repository.name}`,
        signalKind: launch.signal.kind,
        subject: launch.signal.subject,
        url: launch.signal.url,
        observedAt: launch.signal.observedAt,
      },
    };
  }

  async function appendNotice(
    agent: PaseoAgentHandle,
    binding: Binding,
    launch: Launch,
    recovering: boolean,
  ) {
    try {
      const item = notice(binding, launch);
      if (recovering) {
        let page = await agent.timeline.refetch({
          direction: "tail",
          limit: 100,
          projection: "canonical",
        });
        for (;;) {
          if (
            page.entries.some(
              (entry) =>
                entry.item.type === "plugin" && entry.item.id === item.id,
            )
          )
            return null;
          if (!page.hasOlder || page.startCursor === null) break;
          page = await agent.timeline.refetch({
            direction: "before",
            cursor: page.startCursor,
            limit: 100,
            projection: "canonical",
          });
        }
      }
      await agent.timeline.append(item);
      return null;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Could not add timeline notice";
    }
  }

  async function reconcile(
    paseo: PaseoApi,
    binding: Binding,
    launch: Launch,
  ): Promise<StartedAgent | null> {
    let cursor: string | undefined;
    let snapshot: PaseoAgent | undefined;
    do {
      const listed = await paseo.agents.list({
        filter: {
          labels: { "paseo-nstack-signal": launch.signal.key },
          includeArchived: true,
        },
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      snapshot = listed.entries.find(
        (entry) => entry.agent.id === launch.agentId,
      )?.agent;
      cursor = listed.pageInfo.nextCursor ?? undefined;
    } while (!snapshot && cursor);
    if (!snapshot) return null;
    const agent = paseo.agents.ref(snapshot);
    if (agent.workspaceId !== binding.workspaceId)
      throw new Error("Stable agent identity belongs to another workspace");
    return {
      agentId: agent.id,
      timelineError: await appendNotice(agent, binding, launch, true),
    };
  }

  async function start(
    paseo: PaseoApi,
    binding: Binding,
    defaults: PluginDefaults,
    launch: Launch,
  ): Promise<StartedAgent> {
    const choice = binding.agent ?? defaults.agent;
    if (!choice)
      throw new LaunchConfigurationError(
        "Choose the plugin's default provider and model",
      );
    const [configuration, skills] = await Promise.all([
      resolveChoice(paseo, choice),
      materializeSkills(),
    ]);
    const prompt = `Handle one nstack orchestration signal.

Read and follow ${join(skills, "nstack-orchestrate/SKILL.md")} before acting. The complete vendored skill tree is at ${skills}.

An enabled workspace binding is standing permission for this handling step. Applying stack:ready to an open issue authorizes a Ready signal under the binding owner's permission. Human comments and commands are filtered to the authenticated GitHub login.

Signal:
${JSON.stringify(launch.signal, null, 2)}

Binding:
${JSON.stringify(binding, null, 2)}

Handle only this signal. Re-read GitHub issue state and labels, apply nstack idempotency, and remain quiet when nothing changes. Dispatch Ready work only while the issue is open and stack:ready is its only workflow label. Conflicting workflow labels require human attention. Agents create missing standard labels and replace the previous workflow label while preserving unrelated labels.`;
    const agent = await paseo.workspaces
      .ref(binding.workspaceId)
      .agents.create({
        agentId: launch.agentId,
        idempotencyKey: launch.idempotencyKey,
        config: {
          provider: configuration.selector,
          modeId: configuration.modeId,
          featureValues: configuration.featureValues,
        },
        title: `nstack · ${launch.signal.subject}`,
        prompt,
        autoArchive: true,
        labels: {
          "paseo-nstack": "orchestrator",
          "paseo-nstack-signal": launch.signal.key,
        },
      });
    return {
      agentId: agent.id,
      timelineError: await appendNotice(agent, binding, launch, false),
    };
  }

  return {
    materializeSkills,
    providerOptions,
    validate,
    reconcile,
    start,
  };
}
