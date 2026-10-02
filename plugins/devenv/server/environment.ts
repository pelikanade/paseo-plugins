import { run } from "./process";
import { findRoot, isTrusted, signature } from "./project";
import {
  decide,
  isApplied,
  needsReload,
  rootState,
  sessionStep,
  sessionStatus,
  shouldLoad,
  status,
} from "./policy";
import type { Application, Decision, RootEvent } from "./policy";
import type { Settings, StatusView } from "../shared/contracts";

const marker = "\0@@PASEO_DEVENV_ENV_SPLIT@@\0";
const captureScript = [
  "env -0",
  "printf '\\0@@PASEO_DEVENV_ENV_SPLIT@@\\0'",
  'script="$("$1" direnv-export)" || exit 3',
  'eval "$script" >/dev/null 2>&1 || exit 4',
  "env -0",
].join("\n");
const denied = new Set([
  "_",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "TERM",
  "NO_COLOR",
  "PAGER",
  "GIT_PAGER",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TEMPDIR",
  "NIX_BUILD_TOP",
]);
export function parseCapture(text: string): Record<string, string> {
  const split = text.indexOf(marker);
  if (split < 0) throw new Error("Missing environment separator");
  const parse = (dump: string): Record<string, string> =>
    Object.fromEntries(
      dump
        .split("\0")
        .filter((item) => item.indexOf("=") > 0)
        .map((item): [string, string] => {
          const index = item.indexOf("=");
          return [item.slice(0, index), item.slice(index + 1)];
        }),
    );
  const before = parse(text.slice(0, split));
  const after = parse(text.slice(split + marker.length));
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) =>
        before[key] !== value &&
        !denied.has(key) &&
        !key.toUpperCase().startsWith("PASEO_") &&
        !key.startsWith("BASH_FUNC_"),
    ),
  );
}
interface Entry {
  phase: "loading" | "ready" | "error";
  stamp: string;
  generation: number;
  at: number;
  error: string | null;
  controller: AbortController;
  pending: Promise<Record<string, string> | undefined> | null;
  env: Record<string, string> | undefined;
}
interface Session {
  root: string | null;
  stamp: string | null;
  generation: number | null;
  application: Application;
}
export class Environments {
  private entries = new Map<string, Entry>();
  private sessions = new Map<string, Session>();
  private tasks = new Set<Promise<unknown>>();
  private controllers = new Set<AbortController>();
  private revision = 0;
  private generation = 0;
  private stopped = false;
  constructor(
    private settings: Settings,
    private readonly sessionWaitMs = 25000,
  ) {}
  configure(settings: Settings) {
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    this.settings = settings;
    this.revision += 1;
    for (const entry of this.entries.values()) entry.controller.abort();
    this.entries.clear();
  }
  private stamp(root: string) {
    return `${String(this.revision)}:${signature(root)}`;
  }
  private state(root: string) {
    const entry = this.entries.get(root);
    return rootState(
      isTrusted(root),
      entry?.stamp === this.stamp(root) ? entry.phase : "detected",
      root,
    );
  }
  view(agentId: string, cwd: string): Omit<StatusView, "autoReload"> {
    const root = findRoot(cwd);
    const session = this.sessions.get(agentId);
    const application: Application = session?.application ?? { $: "Host" };
    if (root === null)
      return {
        root: null,
        status: null,
        applied: isApplied(application),
        needsReload: isApplied(application),
        error: null,
      };
    const entry = this.entries.get(root);
    const fresh =
      session?.root === root &&
      session.stamp === this.stamp(root) &&
      (entry === undefined || session.generation === entry.generation);
    const state = this.state(root);
    return {
      root,
      status: status(state),
      applied: isApplied(application),
      needsReload: needsReload(state, application, fresh),
      error: entry?.error ?? null,
    };
  }
  forget(agentId: string) {
    this.sessions.delete(agentId);
  }
  private own<T>(task: Promise<T>): Promise<T> {
    const tracked = task.finally(() => {
      this.tasks.delete(tracked);
    });
    this.tasks.add(tracked);
    return tracked;
  }
  private async prepare(
    root: string,
    force: boolean,
    allowRequested: boolean,
  ): Promise<Record<string, string> | undefined> {
    if (this.stopped || !isTrusted(root)) return undefined;
    const stamp = this.stamp(root);
    let current = this.entries.get(root);
    if (current?.stamp !== stamp) {
      current?.controller.abort();
      this.entries.delete(root);
      current = undefined;
    }
    if (current?.pending) return current.pending;
    if (!force && current?.stamp === stamp) {
      if (current.phase === "ready") return current.env;
      if (Date.now() - current.at < this.settings.failureRetryMs)
        return undefined;
    }
    const event: RootEvent =
      current?.phase === "ready"
        ? { $: "EvProjectChanged" }
        : current?.phase === "error"
          ? { $: "EvCooldownElapsed" }
          : { $: allowRequested ? "EvAllowRequested" : "EvSessionOpen" };
    if (!shouldLoad(this.state(root), event)) return undefined;
    while (
      this.entries.size >= this.settings.maxRoots &&
      !this.entries.has(root)
    ) {
      const oldest = [...this.entries].find(
        ([, value]) => value.pending === null,
      );
      if (oldest) this.entries.delete(oldest[0]);
      else {
        await Promise.race(
          [...this.entries.values()].flatMap((value) =>
            value.pending === null ? [] : [value.pending],
          ),
        );
        return this.prepare(root, force, allowRequested);
      }
    }
    const settings = this.settings;
    const controller = new AbortController();
    this.generation += 1;
    const entry: Entry = {
      phase: "loading",
      stamp,
      generation: this.generation,
      at: Date.now(),
      error: null,
      controller,
      pending: null,
      env: undefined,
    };
    this.entries.set(root, entry);
    this.controllers.add(controller);
    const timeout = setTimeout(() => {
      controller.abort();
    }, settings.loadTimeoutMs);
    const task = (async () => {
      try {
        const output = await run(
          ["bash", "-c", captureScript, "paseo-devenv-env", settings.devenvBin],
          root,
          {
            ...process.env,
            ...(settings.runtimeDir
              ? { XDG_RUNTIME_DIR: settings.runtimeDir }
              : {}),
          },
          controller.signal,
          settings.maxCaptureBytes,
        );
        if (
          this.stopped ||
          this.entries.get(root) !== entry ||
          !isTrusted(root) ||
          this.stamp(root) !== stamp
        ) {
          if (this.entries.get(root) === entry) this.entries.delete(root);
          return undefined;
        }
        entry.env = parseCapture(output);
        entry.phase = "ready";
        return entry.env;
      } catch (error) {
        entry.phase = "error";
        entry.error = error instanceof Error ? error.message : String(error);
        console.warn(`devenv: ${root}: ${entry.error}`);
        return undefined;
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(controller);
        entry.pending = null;
        entry.at = Date.now();
      }
    })();
    entry.pending = task;
    return task;
  }
  load(
    cwd: string,
    force = false,
    allowRequested = false,
  ): Promise<Record<string, string> | undefined> {
    const root = findRoot(cwd);
    return root === null
      ? Promise.resolve(undefined)
      : this.own(this.prepare(root, force, allowRequested));
  }
  async allow(cwd: string): Promise<void> {
    const root = findRoot(cwd);
    if (root === null) throw new Error("No devenv.nix found");
    const controller = new AbortController();
    this.controllers.add(controller);
    const timeout = setTimeout(
      () => {
        controller.abort();
      },
      Math.min(this.settings.loadTimeoutMs, 25000),
    );
    try {
      await this.own(
        run(
          [this.settings.devenvBin, "allow"],
          root,
          process.env,
          controller.signal,
          65536,
        ),
      );
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }
  async open(
    agentId: string,
    cwd: string,
    env: Record<string, string>,
    signal: AbortSignal,
  ): Promise<Record<string, string>> {
    const isCanceled = () => signal.aborted;
    if (isCanceled() || this.stopped) return env;
    const root = findRoot(cwd);
    const session: Session = {
      root,
      stamp: null,
      generation: null,
      application: { $: "Host" },
    };
    this.sessions.set(agentId, session);
    if (root === null) return env;
    const task = this.load(cwd);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let canceled: (() => void) | undefined;
    const budget = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => {
        resolve(undefined);
      }, this.sessionWaitMs);
      canceled = () => {
        resolve(undefined);
      };
      signal.addEventListener("abort", canceled, { once: true });
      if (signal.aborted) canceled();
    });
    let values: Record<string, string> | undefined;
    try {
      values = await Promise.race([task, budget]);
    } finally {
      clearTimeout(timer);
      if (canceled) signal.removeEventListener("abort", canceled);
    }
    if (isCanceled()) return env;
    const state = this.state(root);
    const decision: Decision =
      values !== undefined &&
      this.entries.get(root)?.env === values &&
      this.entries.get(root)?.stamp === this.stamp(root)
        ? decide(state)
        : { $: "Skip" };
    if (decision.$ === "Give") {
      session.application = sessionStep(session.application, {
        $: "EvOpened",
        decision,
      });
      session.stamp = this.stamp(root);
      session.generation = this.entries.get(root)?.generation ?? null;
    } else
      session.application = sessionStep(session.application, {
        $: "EvBudgetElapsed",
      });
    return {
      ...(decision.$ === "Give" ? values : {}),
      ...env,
      PASEO_DEVENV_ROOT: root,
      PASEO_DEVENV_STATUS: sessionStatus(state, session.application),
    };
  }
  async close() {
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([...this.tasks]);
    this.entries.clear();
    this.sessions.clear();
  }
}
