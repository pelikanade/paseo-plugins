import type { PluginHookContext } from "@getpaseo/plugin/server";
import { setImmediate } from "node:timers/promises";
import type { Settings, StatusView } from "../shared/contracts";
import type { Environments } from "./environment";
import { run } from "./process";
import { findRoot } from "./project";
import { daemonHome, reloadAgent } from "./daemon";

interface Reload {
  controller: AbortController;
  allowed: Promise<void>;
  pending: Promise<void>;
}

export class TrustReloads {
  private reloads = new Map<string, Reload>();
  private errors = new Map<string, string>();
  private stopped = false;

  constructor(
    private readonly environments: Environments,
    private readonly settings: () => Settings,
  ) {}

  view(agentId: string, cwd: string): StatusView {
    const view = this.environments.view(agentId, cwd);
    return {
      ...view,
      autoReload: this.reloads.has(agentId),
      error: view.error ?? this.errors.get(agentId) ?? null,
    };
  }

  allow(
    agentId: string,
    cwd: string,
    paseo: PluginHookContext["paseo"],
  ): Promise<void> {
    if (this.stopped) return Promise.reject(new Error("devenv is stopped"));
    const existing = this.reloads.get(agentId);
    if (existing) return existing.allowed;
    this.errors.delete(agentId);
    const controller = new AbortController();
    const canceled = () => controller.signal.aborted;
    const root = findRoot(cwd);
    const allowed = this.environments.allow(cwd);
    let timedOut = false;
    const pending = (async () => {
      await allowed;
      if (canceled()) return;
      const values = await this.environments.load(cwd, true, true);
      if (values === undefined || canceled()) return;
      await setImmediate();
      const current = await paseo.agents.ref(agentId).refresh();
      if (!current || current.agent.archivedAt || canceled()) return;
      const view = this.environments.view(agentId, current.agent.cwd);
      if (view.root !== root || view.status !== "ready" || !view.needsReload)
        return;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 60000);
      try {
        const binary = this.settings().paseoBin;
        if (binary === "paseo") await reloadAgent(agentId, controller.signal);
        else
          await run(
            [binary, "--home", daemonHome(), "agent", "reload", agentId],
            current.agent.cwd,
            process.env,
            controller.signal,
            65536,
          );
      } finally {
        clearTimeout(timer);
      }
    })()
      .catch((error: unknown) => {
        if (canceled() && !timedOut) return;
        const message = error instanceof Error ? error.message : String(error);
        this.errors.set(agentId, `Automatic agent reload failed: ${message}`);
        console.error(`devenv: ${agentId}: ${message}`);
      })
      .finally(() => {
        if (this.reloads.get(agentId)?.controller === controller)
          this.reloads.delete(agentId);
      });
    this.reloads.set(agentId, { controller, allowed, pending });
    return allowed;
  }

  forget(agentId: string) {
    this.reloads.get(agentId)?.controller.abort();
    this.errors.delete(agentId);
  }

  applied(agentId: string) {
    this.errors.delete(agentId);
  }

  async close() {
    this.stopped = true;
    for (const reload of this.reloads.values()) reload.controller.abort();
    await Promise.allSettled(
      [...this.reloads.values()].map((reload) => reload.pending),
    );
    this.errors.clear();
  }
}
