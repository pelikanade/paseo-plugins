import type { PaseoApi } from "@getpaseo/client";
import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  checkNowRpc,
  discoverRpc,
  panelRpc,
  saveSettingsRpc,
  setPauseRpc,
  testConnectionRpc,
  type Binding,
  type GitHubProblem,
  type PanelState,
} from "../shared/contracts";
import { createGitHub, GitHubAccessError, type GitHubOptions } from "./github";
import { collectSignals, type Collection } from "./signals";
import {
  createStarter,
  launchIdentity,
  LaunchConfigurationError,
  type ProviderOption,
  type StartedAgent,
} from "./spawn";
import {
  appendActivity,
  createState,
  initialWorkspaceState,
  workspaceState,
  type Launch,
} from "./state";

export interface WatcherOptions {
  github: GitHubOptions;
}

interface CheckReport {
  observed: number;
  started: number;
  handled: number;
  errors: number;
}
const MAX_LAUNCH_ATTEMPTS = 5;
const LAUNCH_RETRY_BASE_MS = 30_000;
const LAUNCH_RETRY_MAX_MS = 15 * 60_000;

function nextWakeTime(
  binding: Binding,
  nextRepairAt: string | null,
  now: number,
) {
  const regular = now + binding.checkEverySeconds * 1000;
  if (binding.repairEverySeconds === null || nextRepairAt === null)
    return regular;
  return Math.min(regular, Date.parse(nextRepairAt));
}

export function installWatcher(
  server: PluginServerContext,
  options: WatcherOptions,
): PluginCleanup {
  const abort = new AbortController();
  const state = createState();
  const github = createGitHub(options.github, abort.signal);
  const starter = createStarter(state.directory);
  const timers = new Map<string, NodeJS.Timeout>();
  const checks = new Map<string, Promise<CheckReport>>();
  let paseo: PaseoApi | undefined;
  let closed = false;
  let initialized: Promise<void> | undefined;
  let providerOptions: Promise<ProviderOption[]> | undefined;
  function watcherClosed() {
    return closed;
  }

  async function bind(api: PaseoApi) {
    if (closed) throw new Error("paseo-nstack is closed");
    if (paseo !== api) {
      paseo = api;
      providerOptions = undefined;
    }
    const request =
      initialized ??
      (async () => {
        await Promise.all([
          starter.materializeSkills(),
          state.read(() => undefined),
        ]);
        const workspaceIds = await state.read((database) =>
          database.bindings.map((binding) => binding.workspaceId),
        );
        await Promise.all(
          workspaceIds.map((workspaceId) => schedule(workspaceId, true)),
        );
      })();
    initialized = request;
    try {
      await request;
    } catch (error) {
      if (initialized === request) initialized = undefined;
      throw error;
    }
  }

  async function availableProviderOptions() {
    const request = providerOptions ?? starter.providerOptions(requirePaseo());
    providerOptions = request;
    try {
      return await request;
    } catch {
      if (providerOptions === request) providerOptions = undefined;
      return [];
    }
  }

  async function panel(workspaceId: string): Promise<PanelState> {
    const available = await availableProviderOptions();
    return state.read((database) => {
      const workspace =
        database.workspaces.find(
          (candidate) => candidate.workspaceId === workspaceId,
        ) ?? initialWorkspaceState(workspaceId);
      const binding =
        database.bindings.find(
          (candidate) => candidate.workspaceId === workspaceId,
        ) ?? null;
      const health = database.recoveryMessage
        ? {
            state: "error" as const,
            message: database.recoveryMessage,
            githubProblem: null,
            login: null,
            lastCheckedAt: null,
            nextCheckAt: null,
          }
        : workspace.health;
      const status = database.recoveryMessage
        ? "error"
        : !binding
          ? "unbound"
          : health.state === "error"
            ? "error"
            : !database.defaults.automaticStarts || binding.paused
              ? "paused"
              : "watching";
      return {
        status,
        defaults: structuredClone(database.defaults),
        binding: binding ? structuredClone(binding) : null,
        health: structuredClone(health),
        counts: structuredClone(workspace.counts),
        attention: structuredClone(workspace.attention),
        activity: database.activity
          .filter((entry) => entry.workspaceId === workspaceId)
          .map((entry) => ({
            id: entry.id,
            at: entry.at,
            kind: entry.kind,
            message: entry.message,
            url: entry.url,
          })),
        providerOptions: available,
      };
    });
  }

  async function schedule(workspaceId: string, immediate: boolean) {
    clearTimeout(timers.get(workspaceId));
    timers.delete(workspaceId);
    if (closed) return;
    const delay = await state.read((database) => {
      const binding = database.bindings.find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      if (!binding) return null;
      if (immediate) return 0;
      const workspace = database.workspaces.find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      const repairAt =
        workspace?.health.state === "error"
          ? null
          : (workspace?.nextRepairAt ?? null);
      const now = Date.now();
      let wake = nextWakeTime(binding, repairAt, now);
      for (const launch of database.launches)
        if (
          launch.workspaceId === workspaceId &&
          launch.state === "failed" &&
          launch.retryAt !== null
        )
          wake = Math.min(wake, Date.parse(launch.retryAt));
      return Math.max(0, wake - now);
    });
    if (watcherClosed() || delay === null) return;
    const timer = setTimeout(() => {
      timers.delete(workspaceId);
      scheduledCheck(workspaceId).catch((error: unknown) => {
        console.error(
          "paseo-nstack schedule failed",
          error instanceof Error ? error.message : "Unknown error",
        );
      });
    }, delay);
    timers.set(workspaceId, timer);
  }
  async function scheduledCheck(workspaceId: string) {
    try {
      await check(workspaceId);
    } catch (error) {
      console.error(
        "paseo-nstack check failed",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
    await schedule(workspaceId, false);
  }

  async function check(workspaceId: string): Promise<CheckReport> {
    const running = checks.get(workspaceId);
    if (running) return running;
    const current = runCheck(workspaceId).finally(() => {
      checks.delete(workspaceId);
    });
    checks.set(workspaceId, current);
    return current;
  }

  async function runCheck(workspaceId: string): Promise<CheckReport> {
    const api = requirePaseo();
    const snapshot = await state.read((database) => {
      const binding = database.bindings.find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      if (!binding) return null;
      const workspace =
        database.workspaces.find(
          (candidate) => candidate.workspaceId === workspaceId,
        ) ?? workspaceState(database, workspaceId);
      return {
        binding: structuredClone(binding),
        workspace: structuredClone(workspace),
      };
    });
    if (!snapshot) throw new Error("This workspace has no GitHub binding");
    const now = new Date();
    const nowText = now.toISOString();
    const due = snapshot.workspace.nextRepairAt;
    const repairDueAt =
      snapshot.binding.repairEverySeconds !== null &&
      due !== null &&
      due <= nowText
        ? due
        : null;

    let collection: Collection;
    try {
      await state.change((database) => {
        const workspace = workspaceState(database, workspaceId);
        workspace.health = {
          ...workspace.health,
          state: "checking",
          message: "Checking GitHub",
        };
      });
      collection = await collectSignals(
        github,
        snapshot.binding,
        snapshot.workspace,
        repairDueAt,
        nowText,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "GitHub check failed";
      await recordFailure(
        workspaceId,
        message,
        nowText,
        error instanceof GitHubAccessError ? error.problem : null,
      );
      return { observed: 0, started: 0, handled: 0, errors: 1 };
    }

    let observed = 0;
    let handled = 0;
    let intents: Launch[];
    try {
      intents = await state.change((database) => {
        const binding = database.bindings.find(
          (candidate) => candidate.workspaceId === workspaceId,
        );
        if (
          !binding ||
          bindingIdentity(binding) !== bindingIdentity(snapshot.binding)
        )
          return [];
        const workspace = workspaceState(database, workspaceId);
        workspace.initialized = true;
        workspace.cursors = collection.cursors;
        workspace.counts = collection.counts;
        workspace.attention = collection.attention;
        if (binding.repairEverySeconds === null) workspace.nextRepairAt = null;
        else if (workspace.nextRepairAt === null || repairDueAt)
          workspace.nextRepairAt = new Date(
            now.getTime() + binding.repairEverySeconds * 1000,
          ).toISOString();
        workspace.health = {
          state: "connected",
          message: `Connected as ${collection.login}`,
          githubProblem: null,
          login: collection.login,
          lastCheckedAt: nowText,
          nextCheckAt: new Date(
            nextWakeTime(binding, workspace.nextRepairAt, now.getTime()),
          ).toISOString(),
        };

        for (const found of collection.signals) {
          const known =
            database.pending.some(
              (candidate) =>
                candidate.workspaceId === workspaceId &&
                candidate.key === found.key,
            ) ||
            database.launches.some(
              (launch) =>
                launch.workspaceId === workspaceId && launch.key === found.key,
            );
          if (known) {
            handled += 1;
            continue;
          }
          database.pending.push({ ...found, workspaceId });
          appendActivity(database, workspaceId, {
            at: nowText,
            kind: found.kind === "repair" ? "repair" : "observed",
            message: `Observed: ${found.subject}`,
            url: found.url,
          });
          observed += 1;
        }

        if (!database.defaults.automaticStarts || binding.paused) return [];
        const selected: Launch[] = [];
        const remaining = [];
        for (const pending of database.pending) {
          if (pending.workspaceId !== workspaceId) {
            remaining.push(pending);
            continue;
          }
          const existing = database.launches.find(
            (launch) =>
              launch.workspaceId === workspaceId && launch.key === pending.key,
          );
          if (existing) continue;
          const identity = launchIdentity(workspaceId, pending.key);
          const launch: Launch = {
            key: pending.key,
            workspaceId,
            ...identity,
            state: "pending",
            signal: {
              key: pending.key,
              kind: pending.kind,
              subject: pending.subject,
              url: pending.url,
              observedAt: pending.observedAt,
              actor: pending.actor,
              data: pending.data,
            },
            error: null,
            attempts: 0,
            retryAt: null,
            createdAt: nowText,
            updatedAt: nowText,
          };
          database.launches.push(launch);
          selected.push(structuredClone(launch));
        }
        database.pending = remaining;
        for (const launch of database.launches) {
          if (launch.workspaceId !== workspaceId || launch.state !== "failed")
            continue;
          if (launch.attempts >= MAX_LAUNCH_ATTEMPTS) {
            launch.state = "blocked";
            launch.retryAt = null;
            continue;
          }
          if (launch.retryAt !== null && launch.retryAt > nowText) continue;
          launch.state = "pending";
          launch.retryAt = null;
          launch.updatedAt = nowText;
          selected.push(structuredClone(launch));
        }
        const blocked = database.launches.find(
          (launch) =>
            launch.workspaceId === workspaceId && launch.state === "blocked",
        );
        if (blocked?.error)
          workspace.health = {
            ...workspace.health,
            state: "error",
            message: blocked.error,
          };
        return selected;
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save GitHub state";
      await recordFailure(workspaceId, message, nowText);
      return { observed: 0, started: 0, handled: 0, errors: 1 };
    }

    const results = await Promise.all(
      intents.map((intent) => dispatch(api, snapshot.binding, intent)),
    );
    return {
      observed,
      started: results.filter((result) => result === "started").length,
      handled,
      errors: results.filter((result) => result === "failed").length,
    };
  }

  async function recordStarted(
    binding: Binding,
    launch: Launch,
    result: StartedAgent,
  ) {
    await state.change((database) => {
      const stored = database.launches.find(
        (candidate) => candidate.agentId === launch.agentId,
      );
      if (!stored) return;
      stored.state = "started";
      stored.error = result.timelineError;
      stored.updatedAt = new Date().toISOString();
      stored.retryAt = null;
      appendActivity(
        database,
        binding.workspaceId,
        {
          at: stored.updatedAt,
          kind: "started",
          message: `Agent started: ${launch.signal.subject}`,
          url: launch.signal.url,
        },
        launch.agentId,
      );
      if (result.timelineError)
        appendActivity(
          database,
          binding.workspaceId,
          {
            at: stored.updatedAt,
            kind: "error",
            message: `Agent started, but its timeline notice failed: ${result.timelineError}`,
            url: launch.signal.url,
          },
          `${launch.agentId}:timeline-error`,
        );
    });
  }

  async function dispatch(api: PaseoApi, binding: Binding, launch: Launch) {
    try {
      const existing = await starter.reconcile(api, binding, launch);
      if (existing) {
        await recordStarted(binding, launch, existing);
        return "recovered" as const;
      }
      const defaults = await state.read((database) =>
        structuredClone(database.defaults),
      );
      const result = await starter.start(api, binding, defaults, launch);
      await recordStarted(binding, launch, result);
      return "started" as const;
    } catch (error) {
      const existing = await starter
        .reconcile(api, binding, launch)
        .catch(() => null);
      if (existing) {
        await recordStarted(binding, launch, existing);
        return "recovered" as const;
      }
      const message =
        error instanceof Error ? error.message : "Agent start failed";
      const failedAt = new Date();
      await state.change((database) => {
        const stored = database.launches.find(
          (candidate) => candidate.agentId === launch.agentId,
        );
        if (stored) {
          stored.attempts += 1;
          stored.state =
            error instanceof LaunchConfigurationError ||
            stored.attempts >= MAX_LAUNCH_ATTEMPTS
              ? "blocked"
              : "failed";
          stored.error = message;
          stored.retryAt =
            stored.state === "failed"
              ? new Date(
                  failedAt.getTime() +
                    Math.min(
                      LAUNCH_RETRY_MAX_MS,
                      LAUNCH_RETRY_BASE_MS *
                        2 ** Math.max(0, stored.attempts - 1),
                    ),
                ).toISOString()
              : null;
          stored.updatedAt = failedAt.toISOString();
        }
        const workspace = workspaceState(database, binding.workspaceId);
        workspace.health = {
          ...workspace.health,
          state: "error",
          message,
          githubProblem: null,
        };
        appendActivity(database, binding.workspaceId, {
          at: failedAt.toISOString(),
          kind: "error",
          message: `Could not start agent: ${message}`,
          url: launch.signal.url,
        });
      });
      return "failed" as const;
    }
  }

  async function recordFailure(
    workspaceId: string,
    message: string,
    checkedAt: string,
    githubProblem: GitHubProblem | null = null,
  ) {
    await state.change((database) => {
      const workspace = workspaceState(database, workspaceId);
      const binding = database.bindings.find(
        (candidate) => candidate.workspaceId === workspaceId,
      );
      const duplicate =
        workspace.health.state === "error" &&
        workspace.health.message === message;
      workspace.health = {
        ...workspace.health,
        state: "error",
        message,
        githubProblem,
        lastCheckedAt: checkedAt,
        nextCheckAt: binding
          ? new Date(
              Date.parse(checkedAt) + binding.checkEverySeconds * 1000,
            ).toISOString()
          : null,
      };
      if (!duplicate)
        appendActivity(database, workspaceId, {
          at: checkedAt,
          kind: "error",
          message,
          url: null,
        });
    });
  }

  function requirePaseo() {
    if (!paseo)
      throw new Error("Waiting for Paseo before automatic starts can run");
    return paseo;
  }

  server.handle(panelRpc, async ({ workspaceId }, context) => {
    await bind(context.paseo);
    return panel(workspaceId);
  });
  server.handle(saveSettingsRpc, async (input, context) => {
    await bind(context.paseo);
    if (input.binding && input.binding.workspaceId !== input.workspaceId)
      throw new Error("Binding workspace does not match this panel");
    if (input.binding && !input.defaults.agent)
      throw new Error("Choose the plugin's default provider and model");
    const changedAgentWorkspaces = await state.change((database) => {
      const previousAgents = new Map(
        database.bindings.map((binding) => [
          binding.workspaceId,
          agentIdentity(binding.agent ?? database.defaults.agent),
        ]),
      );
      database.defaults = input.defaults;
      const previous = database.bindings.find(
        (binding) => binding.workspaceId === input.workspaceId,
      );
      database.bindings = database.bindings.filter(
        (binding) => binding.workspaceId !== input.workspaceId,
      );
      if (input.binding) database.bindings.push(input.binding);
      if (!input.binding) {
        database.workspaces = database.workspaces.filter(
          (workspace) => workspace.workspaceId !== input.workspaceId,
        );
        database.pending = database.pending.filter(
          (pending) => pending.workspaceId !== input.workspaceId,
        );
        database.launches = database.launches.filter(
          (launch) => launch.workspaceId !== input.workspaceId,
        );
        database.activity = database.activity.filter(
          (activity) => activity.workspaceId !== input.workspaceId,
        );
      } else if (
        !previous ||
        bindingIdentity(previous) !== bindingIdentity(input.binding)
      ) {
        database.pending = database.pending.filter(
          (pending) => pending.workspaceId !== input.workspaceId,
        );
        database.launches = database.launches.filter(
          (launch) => launch.workspaceId !== input.workspaceId,
        );
        database.activity = database.activity.filter(
          (activity) => activity.workspaceId !== input.workspaceId,
        );
        const workspace = workspaceState(database, input.workspaceId);
        workspace.initialized = false;
        workspace.cursors = {};
        workspace.counts = {
          ready: 0,
          building: 0,
          reviewing: 0,
          mergeQueue: 0,
          needsYou: 0,
        };
        workspace.attention = [];
        workspace.nextRepairAt = input.binding.repairEverySeconds
          ? new Date(
              Date.now() + input.binding.repairEverySeconds * 1000,
            ).toISOString()
          : null;
      } else if (
        previous.repairEverySeconds !== input.binding.repairEverySeconds
      ) {
        const workspace = workspaceState(database, input.workspaceId);
        workspace.nextRepairAt = input.binding.repairEverySeconds
          ? new Date(
              Date.now() + input.binding.repairEverySeconds * 1000,
            ).toISOString()
          : null;
      }
      const changed = database.bindings
        .filter(
          (binding) =>
            previousAgents.get(binding.workspaceId) !==
            agentIdentity(binding.agent ?? database.defaults.agent),
        )
        .map((binding) => binding.workspaceId);
      const retryAt = new Date().toISOString();
      for (const launch of database.launches) {
        if (
          !changed.includes(launch.workspaceId) ||
          (launch.state !== "blocked" && launch.state !== "failed")
        )
          continue;
        launch.state = "failed";
        launch.attempts = 0;
        launch.retryAt = retryAt;
        launch.error = null;
        launch.updatedAt = retryAt;
      }
      return changed;
    });
    await Promise.all(
      [...new Set([input.workspaceId, ...changedAgentWorkspaces])].map(
        (workspaceId) => schedule(workspaceId, true),
      ),
    );
    return panel(input.workspaceId);
  });
  server.handle(discoverRpc, async (input, context) => {
    await bind(context.paseo);
    try {
      return await github.discover(input.owner, input.repository);
    } catch (error) {
      if (error instanceof GitHubAccessError) return { problem: error.problem };
      throw error;
    }
  });
  server.handle(testConnectionRpc, async (input, context) => {
    await bind(context.paseo);
    try {
      const choice = input.binding.agent ?? input.defaults.agent;
      if (!choice)
        throw new Error("Choose the plugin's default provider and model");
      const discovery = await github.discover(
        input.binding.repository.owner,
        input.binding.repository.name,
      );
      const project = discovery.projects.find(
        (candidate) => candidate.id === input.binding.project.id,
      );
      const field = project?.fields.find(
        (candidate) => candidate.id === input.binding.statusField.id,
      );
      if (!project || !field)
        throw new Error(
          "The selected GitHub Project or status field is unavailable",
        );
      if (
        !field.options.some(
          (option) => option.id === input.binding.readyValue.id,
        )
      )
        throw new Error("The selected Ready value is unavailable");
      await starter.validate(context.paseo, choice);
      return {
        ok: true,
        login: discovery.login,
        message: `Connected as ${discovery.login}`,
        githubProblem: null,
      };
    } catch (error) {
      return {
        ok: false,
        login: null,
        githubProblem:
          error instanceof GitHubAccessError ? error.problem : null,
        message:
          error instanceof Error ? error.message : "Connection test failed",
      };
    }
  });
  server.handle(setPauseRpc, async (input, context) => {
    await bind(context.paseo);
    const workspaceIds = await state.change((database) => {
      if (input.scope === "all")
        database.defaults.automaticStarts = !input.paused;
      else {
        const binding = database.bindings.find(
          (candidate) => candidate.workspaceId === input.workspaceId,
        );
        if (!binding) throw new Error("This workspace has no GitHub binding");
        binding.paused = input.paused;
      }
      return database.bindings.map((binding) => binding.workspaceId);
    });
    if (!input.paused)
      await Promise.all(workspaceIds.map((workspaceId) => check(workspaceId)));
    return panel(input.workspaceId);
  });
  server.handle(checkNowRpc, async ({ workspaceId }, context) => {
    await bind(context.paseo);
    const report = await check(workspaceId);
    await schedule(workspaceId, false);
    return report;
  });

  const cleanups = [
    server.on("agent.created", (_event, context) => bind(context.paseo)),
    server.on("workspace.created", (_event, context) => bind(context.paseo)),
  ];

  return async () => {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const cleanup of cleanups) cleanup();
    abort.abort();
    await Promise.allSettled(checks.values());
    await state.read(() => undefined);
  };
}

function bindingIdentity(binding: Binding) {
  return [
    binding.repository.owner,
    binding.repository.name,
    binding.project.id,
    binding.statusField.id,
    binding.readyValue.id,
  ].join("\u0000");
}

function agentIdentity(choice: Binding["agent"]) {
  return choice ? `${choice.provider}\u0000${choice.model ?? ""}` : "";
}
