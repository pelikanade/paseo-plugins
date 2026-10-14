import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  HandoffResult,
  RequestInput,
  ResolvedStatus,
  SecretRequest,
} from "../shared/protocol";
import {
  HANDOFF_TTL_MS,
  TIMELINE_KIND,
  TIMELINE_VERSION,
} from "../shared/protocol";
import {
  deleteValue,
  prepareHandoff,
  sweepExpired,
  writeValue,
} from "./handoff";
import type { Handoff } from "./handoff";

type Api = PluginHandlerContext["paseo"];

const APPEND_ATTEMPTS = 15;
const APPEND_RETRY_MS = 200;
const SWEEP_INTERVAL_MS = 60000;

interface Entry {
  record: SecretRequest;
  agentId: string;
  root: string;
  expiresAt: number | null;
  timer: NodeJS.Timeout | undefined;
  waiters: Set<(result: HandoffResult) => void>;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const TRAILING_QUALIFIER = / *[({[][^)\]}]*[)\]}] *[.:;,]*$/u;

function comparableLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(TRAILING_QUALIFIER, "")
    .replace(/[.:;,]+$/u, "")
    .trim();
}

function wire(record: SecretRequest) {
  return {
    requestId: record.requestId,
    label: record.label,
    status: record.status,
    createdAt: record.createdAt,
    ...(record.description === undefined
      ? {}
      : { description: record.description }),
    ...(record.hint === undefined ? {} : { hint: record.hint }),
  };
}

export class Requests {
  private readonly entries = new Map<string, Entry>();
  private readonly pendingByAgent = new Map<string, string>();
  private readonly uncollectedByLabel = new Map<string, string>();
  private readonly uid =
    typeof process.getuid === "function" ? process.getuid() : 0;
  private handoff: Promise<Handoff> | undefined;
  private sweeper: NodeJS.Timeout | undefined;

  constructor(private readonly scope: () => Promise<string>) {}

  prepare(): Promise<Handoff> {
    this.handoff ??= (async () => {
      const scope = await this.scope();
      const prepared = await prepareHandoff(this.uid, scope);
      if (prepared.status === "unavailable") {
        console.warn(`secret-request: ${prepared.message}`);
        return prepared;
      }
      this.sweeper = setInterval(() => {
        this.sweep(scope).catch(console.error);
      }, SWEEP_INTERVAL_MS);
      this.sweeper.unref();
      await this.sweep(scope);
      return prepared;
    })().catch((error: unknown): Handoff => ({
      status: "unavailable",
      message: `Cannot prepare the handoff directory: ${describe(error)}`,
    }));
    return this.handoff;
  }

  private async sweep(scope: string): Promise<void> {
    try {
      const { removed, failed, reason } = await sweepExpired(this.uid, scope);
      if (removed > 0)
        console.warn(
          `secret-request: swept ${String(removed)} expired handoff file(s) left by earlier daemon lifetimes`,
        );
      if (failed > 0)
        console.warn(
          `secret-request: could not sweep ${String(failed)} handoff director(ies): ${reason ?? "Unknown error"}`,
        );
    } catch (error) {
      console.warn("secret-request: handoff sweep failed", describe(error));
    }
  }

  private labelKey(agentId: string, label: string): string {
    return `${agentId}\u0000${comparableLabel(label)}`;
  }

  private releaseLabel(entry: Entry) {
    const key = this.labelKey(entry.agentId, entry.record.label);
    if (this.uncollectedByLabel.get(key) === entry.record.requestId)
      this.uncollectedByLabel.delete(key);
  }

  private releaseAgent(entry: Entry) {
    if (this.pendingByAgent.get(entry.agentId) === entry.record.requestId)
      this.pendingByAgent.delete(entry.agentId);
  }

  private forget(entry: Entry) {
    this.releaseAgent(entry);
    this.releaseLabel(entry);
    this.entries.delete(entry.record.requestId);
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private settle(entry: Entry, result: HandoffResult) {
    for (const waiter of entry.waiters) waiter(result);
    entry.waiters.clear();
  }

  private attach(
    entry: Entry,
    signal: AbortSignal | undefined,
  ): Promise<HandoffResult> {
    return new Promise<HandoffResult>((resolve) => {
      const deliver = (result: HandoffResult) => {
        entry.waiters.delete(deliver);
        signal?.removeEventListener("abort", drop);
        resolve(result);
      };
      const drop = () => {
        entry.waiters.delete(deliver);
        signal?.removeEventListener("abort", drop);
        resolve({
          status: "gone",
          requestId: entry.record.requestId,
          label: entry.record.label,
          path: null,
          handoffExpiresAt: null,
          message:
            "This call was canceled before the user answered; the request is still pending",
        });
      };
      if (signal?.aborted === true) {
        drop();
        return;
      }
      signal?.addEventListener("abort", drop, { once: true });
      entry.waiters.add(deliver);
    });
  }

  private delivered(entry: Entry): HandoffResult {
    return {
      status: "delivered",
      requestId: entry.record.requestId,
      label: entry.record.label,
      path:
        entry.expiresAt === null
          ? null
          : join(entry.root, entry.record.requestId),
      handoffExpiresAt:
        entry.expiresAt === null
          ? null
          : new Date(entry.expiresAt).toISOString(),
      message: null,
    };
  }

  private async handoffFileExists(entry: Entry): Promise<boolean> {
    try {
      const stats = await stat(join(entry.root, entry.record.requestId));
      return stats.isFile();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return false;
      throw error;
    }
  }

  private async recover(
    agentId: string,
    label: string,
  ): Promise<HandoffResult | null> {
    const key = this.labelKey(agentId, label);
    const requestId = this.uncollectedByLabel.get(key);
    if (requestId === undefined) return null;
    this.uncollectedByLabel.delete(key);
    const entry = this.entries.get(requestId);
    if (
      entry === undefined ||
      entry.expiresAt === null ||
      !(await this.handoffFileExists(entry))
    )
      return null;
    return {
      ...this.delivered(entry),
      message: `The value requested as "${entry.record.label}" was handed over before this call, and this is its handoff file`,
    };
  }

  private async publish(entry: Entry, paseo: Api): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await paseo.agents.ref(entry.agentId).timeline.append({
          type: "plugin",
          id: entry.record.requestId,
          kind: TIMELINE_KIND,
          version: TIMELINE_VERSION,
          data: wire(entry.record),
        });
        return;
      } catch (error) {
        if (attempt >= APPEND_ATTEMPTS) throw error;
        await delay(APPEND_RETRY_MS);
      }
    }
  }

  async request(
    agentId: string,
    input: RequestInput,
    paseo: Api,
    signal: AbortSignal | undefined,
  ): Promise<HandoffResult> {
    const handoff = await this.prepare();
    if (handoff.status === "unavailable")
      return {
        status: "unavailable",
        requestId: "",
        label: input.label,
        path: null,
        handoffExpiresAt: null,
        message: handoff.message,
      };
    const pendingId = this.pendingByAgent.get(agentId);
    const pending =
      pendingId === undefined ? undefined : this.entries.get(pendingId);
    if (pending !== undefined) return this.attach(pending, signal);
    const recovered = await this.recover(agentId, input.label);
    if (recovered !== null) return recovered;
    const record: SecretRequest = {
      requestId: randomUUID(),
      label: input.label,
      status: "pending",
      createdAt: new Date().toISOString(),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.hint === undefined ? {} : { hint: input.hint }),
    };
    const entry: Entry = {
      record,
      agentId,
      root: handoff.root,
      expiresAt: null,
      timer: undefined,
      waiters: new Set(),
    };
    this.entries.set(record.requestId, entry);
    this.pendingByAgent.set(agentId, record.requestId);
    try {
      await this.publish(entry, paseo);
    } catch (error) {
      this.forget(entry);
      return {
        status: "gone",
        requestId: record.requestId,
        label: record.label,
        path: null,
        handoffExpiresAt: null,
        message: `The request could not be shown in this conversation: ${describe(error)}`,
      };
    }
    return this.attach(entry, signal);
  }

  async submit(
    agentId: string,
    requestId: string,
    value: string,
    paseo: Api,
  ): Promise<HandoffResult> {
    const entry = this.entries.get(requestId);
    if (!entry || entry.agentId !== agentId)
      return {
        status: "gone",
        requestId,
        label: "",
        path: null,
        handoffExpiresAt: null,
        message: "This request is no longer active",
      };
    if (entry.record.status === "delivered") return this.delivered(entry);
    if (entry.record.status === "canceled")
      return {
        status: "canceled",
        requestId,
        label: entry.record.label,
        path: null,
        handoffExpiresAt: null,
        message: "The request was canceled",
      };
    try {
      await writeValue(this.uid, entry.root, requestId, value);
    } catch (error) {
      const result: HandoffResult = {
        status: "unavailable",
        requestId,
        label: entry.record.label,
        path: null,
        handoffExpiresAt: null,
        message: `The value could not be handed over: ${describe(error)}`,
      };
      this.settle(entry, result);
      this.forget(entry);
      return result;
    }
    entry.record = { ...entry.record, status: "delivered" };
    this.releaseAgent(entry);
    entry.expiresAt = Date.now() + HANDOFF_TTL_MS;
    if (entry.waiters.size === 0)
      this.uncollectedByLabel.set(
        this.labelKey(entry.agentId, entry.record.label),
        requestId,
      );
    entry.timer = setTimeout(() => {
      this.releaseLabel(entry);
      entry.expiresAt = null;
      entry.timer = undefined;
      deleteValue(entry.root, requestId).catch((error: unknown) => {
        console.warn("secret-request: handoff cleanup failed", describe(error));
      });
    }, HANDOFF_TTL_MS);
    await this.publish(entry, paseo).catch((error: unknown) => {
      console.warn("secret-request: delivery update failed", describe(error));
    });
    const result = this.delivered(entry);
    this.settle(entry, result);
    return result;
  }

  async cancel(
    agentId: string,
    requestId: string,
    paseo: Api,
  ): Promise<{ status: ResolvedStatus; message: string | null }> {
    const entry = this.entries.get(requestId);
    if (!entry || entry.agentId !== agentId)
      return { status: "gone", message: "This request is no longer active" };
    if (entry.record.status === "delivered")
      return {
        status: "delivered",
        message: "The value was already handed over",
      };
    if (entry.record.status === "canceled")
      return { status: "canceled", message: null };
    entry.record = { ...entry.record, status: "canceled" };
    this.releaseAgent(entry);
    await this.publish(entry, paseo).catch((error: unknown) => {
      console.warn(
        "secret-request: cancellation update failed",
        describe(error),
      );
    });
    this.settle(entry, {
      status: "canceled",
      requestId,
      label: entry.record.label,
      path: null,
      handoffExpiresAt: null,
      message: "The user declined to provide the value",
    });
    return { status: "canceled", message: null };
  }

  status(
    agentId: string,
    requestId: string,
  ): { status: ResolvedStatus; handoffExpiresAt: string | null } {
    const entry = this.entries.get(requestId);
    if (!entry || entry.agentId !== agentId)
      return { status: "gone", handoffExpiresAt: null };
    return {
      status: entry.record.status,
      handoffExpiresAt:
        entry.expiresAt === null
          ? null
          : new Date(entry.expiresAt).toISOString(),
    };
  }

  async abortAgent(agentId: string): Promise<void> {
    for (const entry of [...this.entries.values()]) {
      if (entry.agentId !== agentId) continue;
      if (entry.record.status === "pending")
        this.settle(entry, {
          status: "gone",
          requestId: entry.record.requestId,
          label: entry.record.label,
          path: null,
          handoffExpiresAt: null,
          message: "The agent was archived",
        });
      await deleteValue(entry.root, entry.record.requestId).catch(
        (error: unknown) => {
          console.warn(
            "secret-request: archive cleanup failed",
            describe(error),
          );
        },
      );
      this.forget(entry);
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
    this.pendingByAgent.clear();
    this.uncollectedByLabel.clear();
  }
}
