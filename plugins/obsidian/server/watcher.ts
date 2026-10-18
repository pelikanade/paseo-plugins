import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import type { ChildProcess } from "node:child_process";
import type { SyncErrorCode } from "../shared/contracts";
import { classifyFailure, lastLine, runOb } from "./ob";

const BACKOFF_CEILING_MS = 60000;
const ONE_SHOT_TIMEOUT_MS = 300000;
const IMMEDIATE_CODES: readonly SyncErrorCode[] = [
  "token_invalid",
  "vault_missing",
  "lock_held",
];

export interface SyncFailure {
  code: SyncErrorCode;
  message: string | null;
}

interface WatcherSnapshot {
  running: boolean;
  pulling: boolean;
  lastSuccessAt: string | null;
  error: SyncFailure | null;
}

export class Watcher {
  private child: ChildProcess | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private active = false;
  private oneShot = false;
  private failures = 0;
  private lastError: SyncFailure | null = null;
  private successAt: Date | null = null;
  private pulling = false;
  private tail = "";
  private pending = "";

  constructor(
    private readonly options: {
      binary: string;
      env: NodeJS.ProcessEnv;
      vaultPath: string;
      token: string | null;
      onSynced?: () => void;
    },
  ) {}

  start(): void {
    this.active = true;
    if (this.child || this.restartTimer || this.oneShot) return;
    this.spawn();
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const child = this.child;
    this.child = null;
    if (!child) return;
    await terminateProcess(child).catch(console.error);
  }

  snapshot(): WatcherSnapshot {
    const error =
      this.lastError &&
      (this.failures >= 2 ||
        IMMEDIATE_CODES.includes(this.lastError.code) ||
        !this.active)
        ? this.lastError
        : null;
    return {
      running: this.active,
      pulling: this.pulling,
      lastSuccessAt: this.successAt?.toISOString() ?? null,
      error,
    };
  }

  async syncNow(): Promise<boolean> {
    if (this.oneShot) return false;
    const resume = this.active;
    await this.stop();
    this.oneShot = true;
    this.pulling = true;
    try {
      const result = await runOb(
        this.options.binary,
        ["sync", "--path", this.options.vaultPath],
        { env: this.options.env, timeoutMs: ONE_SHOT_TIMEOUT_MS },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      if (result.code === 0 && /Fully synced/.test(result.stdout)) {
        this.successAt = new Date();
        this.lastError = null;
        this.failures = 0;
        this.options.onSynced?.();
      } else {
        this.lastError = classifyFailure(output, this.options.token);
        this.failures += 1;
      }
    } finally {
      this.oneShot = false;
      this.pulling = false;
      if (resume) this.start();
    }
    return true;
  }

  private spawn(): void {
    let child: ChildProcess;
    try {
      child = spawnProcess(
        this.options.binary,
        ["sync", "--path", this.options.vaultPath, "--continuous"],
        { env: this.options.env, stdio: "pipe" },
      );
    } catch (error) {
      this.recordFailure(
        error instanceof Error ? error.message : String(error),
      );
      return;
    }
    this.child = child;
    this.pulling = true;
    this.pending = "";
    this.tail = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      this.consume(chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.consume(chunk.toString());
    });
    child.on("error", (error) => {
      this.consume(error.message);
    });
    child.on("close", () => {
      if (this.child !== child) return;
      this.child = null;
      if (!this.active) return;
      this.recordFailure(this.tail);
    });
  }

  private consume(chunk: string): void {
    this.tail = `${this.tail}${chunk}`.slice(-8192);
    this.pending += chunk;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    for (const line of lines) this.observe(line.trim());
  }

  private observe(line: string): void {
    if (line.endsWith("Fully synced")) {
      this.successAt = new Date();
      this.lastError = null;
      this.failures = 0;
      this.pulling = false;
      this.options.onSynced?.();
      return;
    }
    if (line.startsWith("Downloading") || line.startsWith("Downloaded"))
      this.pulling = true;
  }

  private recordFailure(output: string): void {
    const failure = classifyFailure(output, this.options.token);
    const message = failure.message ?? (lastLine(output) || null);
    this.lastError = { code: failure.code, message };
    this.failures += 1;
    this.pulling = false;
    const delay = Math.min(
      1000 * 2 ** Math.max(0, this.failures - 1),
      BACKOFF_CEILING_MS,
    );
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.active) this.spawn();
    }, delay);
  }
}
