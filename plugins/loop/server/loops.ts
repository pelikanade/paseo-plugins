import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { armError } from "../shared/arm";
import type { LoopStatus } from "../shared/contracts";
import type { WakeReason } from "../shared/messages";
import { wakeText } from "../shared/messages";
import { purposeFrom } from "../shared/parse";

type Api = PluginHandlerContext["paseo"];
type Agent = NonNullable<
  Awaited<ReturnType<ReturnType<Api["agents"]["ref"]>["refresh"]>>
>["agent"];

interface Armed {
  generation: number;
  agentId: string;
  cwd: string;
  purpose: string;
  prompt: string;
  mode: "fixed" | "dynamic";
  everySeconds: number | null;
  heartbeatSeconds: number | null;
  watch: string[] | null;
  watcher: ChildProcess | null;
  watcherState: "off" | "running" | "exited";
  watchPid: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  nextDueAt: string | null;
  pending: { reason: WakeReason } | null;
  busy: boolean;
  flushScheduled: boolean;
  lastWakeAt: string | null;
  lastReason: WakeReason | null;
  error: string | null;
}

function stoppedStatus(): LoopStatus {
  return {
    state: "stopped",
    purpose: null,
    prompt: null,
    mode: null,
    everySeconds: null,
    heartbeatSeconds: null,
    watch: null,
    watcher: "off",
    watchPid: null,
    nextDueAt: null,
    pending: false,
    lastWakeAt: null,
    lastReason: null,
    error: null,
  };
}

function failure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Wake failed";
  return message.slice(0, 500);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(-pid, name);
  } catch (error) {
    if (errorCode(error) === "ESRCH") return;
    try {
      process.kill(pid, name);
    } catch (again) {
      if (errorCode(again) !== "ESRCH")
        console.warn("loop: failed to stop watcher", failure(again));
    }
  }
}

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
  return "";
}

function blocked(agent: Agent): boolean {
  return (
    agent.status === "running" ||
    agent.status === "initializing" ||
    agent.activeTurn != null ||
    agent.pendingPermissions.length > 0
  );
}

export class Loops {
  private paseo: Api | undefined;
  private stopped = false;
  private readonly loops = new Map<string, Armed>();
  private readonly tails = new Map<string, Promise<void>>();

  bind(paseo: Api) {
    this.paseo = paseo;
  }

  async requireAgent(agentId: string, paseo: Api) {
    this.bind(paseo);
    const result = await paseo.agents.ref(agentId).refresh();
    if (!result) throw new Error("Unknown agent");
    if (result.agent.archivedAt) throw new Error("Agent is unavailable");
    return result.agent;
  }

  async status(agentId: string, paseo: Api): Promise<LoopStatus> {
    const result = await paseo.agents.ref(agentId).refresh();
    if (!result) throw new Error("Unknown agent");
    if (result.agent.archivedAt) {
      this.stop(agentId);
      return stoppedStatus();
    }
    return this.view(agentId);
  }

  async arm(
    input: {
      agentId: string;
      prompt: string;
      mode: "fixed" | "dynamic";
      everySeconds?: number;
      heartbeatSeconds?: number;
      watch?: string[];
      purpose?: string;
    },
    paseo: Api,
  ): Promise<LoopStatus> {
    const error = armError(input);
    if (error) throw new Error(error);
    if (input.watch?.some((arg) => arg.includes("\0")))
      throw new Error("Watcher arguments cannot contain NUL");
    const agent = await this.requireAgent(input.agentId, paseo);
    if (input.watch && agent.cwd.length === 0)
      throw new Error("Agent has no working directory");
    if (!this.loops.has(input.agentId) && this.loops.size >= 100)
      throw new Error("Too many loops");
    const previous = this.loops.get(input.agentId);
    if (previous) this.drop(previous);
    const loop: Armed = {
      generation: 1,
      agentId: input.agentId,
      cwd: agent.cwd,
      purpose: input.purpose ?? purposeFrom(input.prompt),
      prompt: input.prompt,
      mode: input.mode,
      everySeconds:
        input.mode === "fixed" ? (input.everySeconds ?? null) : null,
      heartbeatSeconds:
        input.mode === "dynamic" ? (input.heartbeatSeconds ?? null) : null,
      watch: input.watch ? [...input.watch] : null,
      watcher: null,
      watcherState: "off",
      watchPid: null,
      timer: null,
      nextDueAt: null,
      pending: null,
      busy: blocked(agent),
      flushScheduled: false,
      lastWakeAt: null,
      lastReason: null,
      error: null,
    };
    this.loops.set(input.agentId, loop);
    if (loop.mode === "fixed") {
      if (loop.everySeconds !== null)
        this.armTimer(loop, loop.everySeconds, "interval");
    } else {
      this.startWatcher(loop);
      if (!loop.busy) this.armHeartbeat(loop, true);
    }
    return this.view(input.agentId);
  }

  stop(agentId: string): LoopStatus {
    const loop = this.loops.get(agentId);
    if (loop) this.drop(loop);
    return stoppedStatus();
  }

  onTurnStarted(agentId: string) {
    const loop = this.loops.get(agentId);
    if (!loop || this.stopped) return;
    loop.busy = true;
  }

  onTurnEnded(agentId: string) {
    const loop = this.loops.get(agentId);
    if (!loop || this.stopped) return Promise.resolve();
    loop.busy = false;
    if (loop.mode === "dynamic") {
      this.armHeartbeat(loop, true);
      if (loop.watch !== null && loop.watcherState === "exited")
        this.startWatcher(loop);
    }
    this.poke(loop);
    return this.tails.get(agentId) ?? Promise.resolve();
  }

  shutdown() {
    this.stopped = true;
    for (const loop of [...this.loops.values()]) this.drop(loop);
    return Promise.all([...this.tails.values()]);
  }

  private view(agentId: string): LoopStatus {
    const loop = this.loops.get(agentId);
    if (!loop) return stoppedStatus();
    return {
      state: "armed",
      purpose: loop.purpose,
      prompt: loop.prompt,
      mode: loop.mode,
      everySeconds: loop.everySeconds,
      heartbeatSeconds: loop.heartbeatSeconds,
      watch: loop.watch,
      watcher: loop.watcherState,
      watchPid: loop.watchPid,
      nextDueAt: loop.nextDueAt,
      pending: loop.pending !== null,
      lastWakeAt: loop.lastWakeAt,
      lastReason: loop.lastReason,
      error: loop.error,
    };
  }

  private drop(loop: Armed) {
    loop.generation += 1;
    if (loop.timer) clearTimeout(loop.timer);
    loop.timer = null;
    loop.nextDueAt = null;
    loop.pending = null;
    this.killWatcher(loop);
    this.loops.delete(loop.agentId);
  }

  private armHeartbeat(loop: Armed, reset: boolean) {
    if (loop.mode !== "dynamic" || loop.heartbeatSeconds === null) return;
    if (loop.timer && !reset) return;
    if (loop.timer) clearTimeout(loop.timer);
    loop.timer = null;
    this.armTimer(loop, loop.heartbeatSeconds, "heartbeat");
  }

  private armTimer(loop: Armed, seconds: number, reason: WakeReason) {
    const generation = loop.generation;
    const timer = setTimeout(() => {
      if (
        loop.generation !== generation ||
        this.stopped ||
        loop.timer !== timer
      )
        return;
      loop.timer = null;
      loop.nextDueAt = null;
      loop.pending = { reason };
      if (reason === "interval" && loop.everySeconds !== null)
        this.armTimer(loop, loop.everySeconds, "interval");
      this.poke(loop);
    }, seconds * 1000);
    timer.unref();
    loop.timer = timer;
    loop.nextDueAt = new Date(Date.now() + seconds * 1000).toISOString();
  }

  private poke(loop: Armed) {
    if (this.stopped || loop.flushScheduled) return;
    loop.flushScheduled = true;
    const run = async () => {
      loop.flushScheduled = false;
      if (this.stopped || this.loops.get(loop.agentId) !== loop) return;
      try {
        const result = await this.flush(loop);
        if (
          result === "sent" &&
          loop.pending !== null &&
          this.loops.get(loop.agentId) === loop
        )
          this.poke(loop);
      } catch (error) {
        loop.error = failure(error);
      }
    };
    const previous = this.tails.get(loop.agentId) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.tails.set(
      loop.agentId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
  }

  private async flush(
    loop: Armed,
  ): Promise<"sent" | "idle" | "deferred" | "stopped"> {
    const generation = loop.generation;
    if (!this.alive(loop, generation) || loop.pending === null) return "idle";
    if (loop.busy) return "deferred";
    const initial = this.takeReason(loop);
    if (initial === null) return "idle";
    let reason = initial;
    const paseo = this.paseo;
    if (!paseo) {
      loop.pending = { reason };
      loop.error = "Loop scheduler is not connected";
      return "deferred";
    }
    try {
      const result = await paseo.agents.ref(loop.agentId).refresh();
      if (!this.alive(loop, generation)) return "stopped";
      const newer = this.takeReason(loop);
      if (newer !== null) reason = newer;
      if (
        !result ||
        result.agent.archivedAt ||
        result.agent.status === "closed"
      ) {
        this.drop(loop);
        return "stopped";
      }
      if (blocked(result.agent)) {
        loop.pending = { reason };
        if (loop.mode === "dynamic") this.armHeartbeat(loop, false);
        return "deferred";
      }
      await paseo.agents.ref(loop.agentId).send(
        wakeText({
          mode: loop.mode,
          purpose: loop.purpose,
          prompt: loop.prompt,
          reason,
        }),
        { messageId: randomUUID() },
      );
      if (!this.alive(loop, generation)) return "stopped";
      loop.lastWakeAt = new Date().toISOString();
      loop.lastReason = reason;
      loop.error = null;
      const after = await paseo.agents.ref(loop.agentId).refresh();
      if (!this.alive(loop, generation)) return "stopped";
      if (!after || after.agent.archivedAt || after.agent.status === "closed") {
        this.drop(loop);
        return "stopped";
      }
      return "sent";
    } catch (error) {
      if (!this.alive(loop, generation)) return "stopped";
      loop.error = failure(error);
      if (loop.mode === "dynamic") this.armHeartbeat(loop, false);
      return "deferred";
    }
  }

  private takeReason(loop: Armed): WakeReason | null {
    const reason = loop.pending?.reason ?? null;
    loop.pending = null;
    return reason;
  }

  private alive(loop: Armed, generation: number) {
    return (
      !this.stopped &&
      loop.generation === generation &&
      this.loops.get(loop.agentId) === loop
    );
  }

  private startWatcher(loop: Armed) {
    const argv = loop.watch;
    const command = argv?.[0];
    if (!argv || command === undefined) return;
    this.killWatcher(loop);
    let child: ChildProcess;
    try {
      child = spawn(command, argv.slice(1), {
        cwd: loop.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      loop.watcherState = "exited";
      loop.error = failure(error);
      return;
    }
    loop.watcher = child;
    loop.watchPid = child.pid ?? null;
    loop.watcherState = "running";
    child.stderr?.on("data", () => undefined);
    const output = child.stdout;
    if (!output) {
      loop.watcher = null;
      loop.watchPid = null;
      loop.watcherState = "exited";
      loop.error = "Watcher has no stdout";
      if (child.pid !== undefined) signal(child.pid, "SIGTERM");
      return;
    }
    let buffer = "";
    const generation = loop.generation;
    output.on("data", (chunk: unknown) => {
      if (!this.alive(loop, generation) || loop.watcher !== child) return;
      buffer += chunkText(chunk);
      if (buffer.length > 65536) {
        buffer = "";
        loop.error = "Watcher line too long";
        return;
      }
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      if (parts.some((part) => part.trim().length > 0)) this.noteWatch(loop);
    });
    child.on("error", (error) => {
      if (loop.watcher !== child) return;
      loop.watcher = null;
      loop.watchPid = null;
      loop.watcherState = "exited";
      loop.error = failure(error);
    });
    child.on("exit", (code) => {
      if (loop.watcher !== child) return;
      const rest = buffer.trim();
      buffer = "";
      loop.watcher = null;
      loop.watchPid = null;
      loop.watcherState = "exited";
      if (rest.length > 0) this.noteWatch(loop);
      else if (code !== 0 && code !== null)
        loop.error = `Watcher exited ${String(code)}`;
    });
  }

  private noteWatch(loop: Armed) {
    if (this.stopped || this.loops.get(loop.agentId) !== loop) return;
    loop.pending = { reason: "watch" };
    this.poke(loop);
  }

  private killWatcher(loop: Armed) {
    const child = loop.watcher;
    loop.watcher = null;
    loop.watchPid = null;
    if (child?.pid !== undefined) signal(child.pid, "SIGTERM");
    if (child) loop.watcherState = "off";
  }
}
