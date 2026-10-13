import { randomUUID } from "node:crypto";
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
import { deleteValue, prepareHandoff, writeValue } from "./handoff";
import type { Handoff } from "./handoff";

type Api = PluginHandlerContext["paseo"];

const APPEND_ATTEMPTS = 15;
const APPEND_RETRY_MS = 200;

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
    ...(record.expectedLength === undefined
      ? {}
      : { expectedLength: record.expectedLength }),
  };
}

export class Requests {
  private readonly entries = new Map<string, Entry>();
  private readonly labels = new Map<string, string>();
  private readonly uid =
    typeof process.getuid === "function" ? process.getuid() : 0;
  private handoff: Promise<Handoff> | undefined;

  constructor(private readonly scope: () => Promise<string>) {}

  private root(): Promise<Handoff> {
    this.handoff ??= (async () => {
      const prepared = await prepareHandoff(this.uid, await this.scope());
      if (prepared.status === "unavailable")
        console.warn(`secret-request: ${prepared.message}`);
      return prepared;
    })().catch((error: unknown): Handoff => ({
      status: "unavailable",
      message: `Cannot prepare the handoff directory: ${describe(error)}`,
    }));
    return this.handoff;
  }

  private forget(entry: Entry) {
    this.entries.delete(entry.record.requestId);
    this.labels.delete(`${entry.agentId}\u0000${entry.record.label}`);
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private settle(entry: Entry, result: HandoffResult) {
    for (const waiter of entry.waiters) waiter(result);
    entry.waiters.clear();
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

  async initialize(): Promise<void> {
    const handoff = await this.root();
    if (handoff.status === "unavailable")
      console.warn(`secret-request: ${handoff.message}`);
  }

  async request(
    agentId: string,
    input: RequestInput,
    paseo: Api,
  ): Promise<HandoffResult> {
    const handoff = await this.root();
    if (handoff.status === "unavailable")
      return {
        status: "unavailable",
        requestId: "",
        label: input.label,
        path: null,
        handoffExpiresAt: null,
        message: handoff.message,
      };
    const key = `${agentId}\u0000${input.label}`;
    const existingId = this.labels.get(key);
    if (existingId !== undefined) {
      const existing = this.entries.get(existingId);
      if (existing)
        return new Promise<HandoffResult>((resolve) => {
          existing.waiters.add(resolve);
        });
    }
    const record: SecretRequest = {
      requestId: randomUUID(),
      label: input.label,
      status: "pending",
      createdAt: new Date().toISOString(),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.hint === undefined ? {} : { hint: input.hint }),
      ...(input.expectedLength === undefined
        ? {}
        : { expectedLength: input.expectedLength }),
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
    this.labels.set(key, record.requestId);
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
    return new Promise<HandoffResult>((resolve) => {
      entry.waiters.add(resolve);
    });
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
    entry.expiresAt = Date.now() + HANDOFF_TTL_MS;
    entry.timer = setTimeout(() => {
      deleteValue(entry.root, requestId).catch((error: unknown) => {
        console.warn("secret-request: handoff cleanup failed", describe(error));
      });
      entry.expiresAt = null;
      entry.timer = undefined;
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
    this.labels.delete(`${entry.agentId}\u0000${entry.record.label}`);
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

  find(agentId: string, requestId?: string, label?: string): string | null {
    if (requestId !== undefined && this.entries.has(requestId))
      return requestId;
    if (label === undefined) return null;
    const key = `${agentId}\u0000${label}`;
    return this.labels.get(key) ?? null;
  }

  async release(agentId: string, requestId: string): Promise<ResolvedStatus> {
    const entry = this.entries.get(requestId);
    if (!entry || entry.agentId !== agentId) return "gone";
    if (entry.record.status !== "delivered") return entry.record.status;
    await deleteValue(entry.root, requestId).catch((error: unknown) => {
      console.warn("secret-request: release failed", describe(error));
    });
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.expiresAt = null;
    return "delivered";
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
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
    this.labels.clear();
  }
}
