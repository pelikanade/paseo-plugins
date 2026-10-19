import { open, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  PluginHookContext,
  PluginServerContext,
} from "@getpaseo/plugin/server";
import { z } from "zod";
import { syncIntentWatchersRpc } from "../shared/contracts";
import {
  INTENT_KIND,
  INTENT_VERSION,
  MAX_INTENT_LENGTH,
} from "../shared/protocol";

type Paseo = PluginHookContext["paseo"];

const POLL_INTERVAL_MS = 200;
const TOOL_ROW_POLL_INTERVAL_MS = 100;
const TOOL_ROW_TIMEOUT_MS = 5000;
const READ_CHUNK_BYTES = 1024 * 1024;
const TURN_SCAN_BYTES = 1024 * 1024;

const sessionEntrySchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("message"),
      message: z
        .object({
          role: z.string(),
          content: z
            .union([
              z.string(),
              z.array(
                z
                  .object({
                    type: z.string(),
                    id: z.string().optional(),
                    intent: z.string().optional(),
                  })
                  .loose(),
              ),
            ])
            .optional(),
        })
        .loose(),
    })
    .loose(),
  z
    .object({
      type: z.literal("custom"),
      customType: z.string(),
      data: z
        .object({
          toolCallId: z.string().optional(),
          intent: z.string().optional(),
        })
        .loose()
        .optional(),
    })
    .loose(),
]);

type SessionEntry = z.infer<typeof sessionEntrySchema>;

interface PendingIntent {
  callId: string;
  intent: string;
}

interface IntentWatcher {
  agentId: string;
  filePath: string;
  paseo: Paseo;
  offset: number | null;
  partial: string;
  seen: Set<string>;
  controller: AbortController;
  stopping: boolean;
  drainChain: Promise<void>;
  publishChain: Promise<void>;
  run: Promise<void>;
}

function intentsFromEntry(entry: SessionEntry): PendingIntent[] {
  if (entry.type === "message") {
    if (
      entry.message.role !== "assistant" ||
      !Array.isArray(entry.message.content)
    ) {
      return [];
    }
    return entry.message.content.flatMap((content) => {
      const intent = content.intent?.trim();
      if (content.type !== "toolCall" || !content.id || !intent) {
        return [];
      }
      return [
        { callId: content.id, intent: intent.slice(0, MAX_INTENT_LENGTH) },
      ];
    });
  }
  if (entry.customType !== "tool_execution_start" || !entry.data) {
    return [];
  }
  const intent = entry.data.intent?.trim();
  if (!entry.data.toolCallId || !intent) {
    return [];
  }
  return [
    {
      callId: entry.data.toolCallId,
      intent: intent.slice(0, MAX_INTENT_LENGTH),
    },
  ];
}

function parseLine(line: string): PendingIntent[] {
  if (!line.includes('"intent"')) {
    return [];
  }
  try {
    const parsed = sessionEntrySchema.safeParse(JSON.parse(line));
    return parsed.success ? intentsFromEntry(parsed.data) : [];
  } catch {
    return [];
  }
}

async function findTurnStartOffset(filePath: string): Promise<number | null> {
  const info = await stat(filePath);
  const length = Math.min(info.size, TURN_SCAN_BYTES);
  if (length <= 0) {
    return null;
  }
  const start = info.size - length;
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
    let offset = start;
    let found: number | null = null;
    for (const [index, line] of lines.entries()) {
      const lineOffset = offset;
      offset += Buffer.byteLength(line, "utf8") + 1;
      if (index === 0 && start > 0) {
        continue;
      }
      try {
        const parsed = sessionEntrySchema.safeParse(JSON.parse(line));
        if (
          parsed.success &&
          parsed.data.type === "message" &&
          parsed.data.message.role === "user"
        ) {
          found = lineOffset;
        }
      } catch {
        continue;
      }
    }
    return found;
  } finally {
    await handle.close();
  }
}

async function readAppended(watcher: IntentWatcher): Promise<void> {
  let info;
  try {
    info = await stat(watcher.filePath);
  } catch {
    return;
  }
  if (watcher.offset === null) {
    watcher.offset = info.size;
    return;
  }
  if (info.size < watcher.offset) {
    watcher.offset = 0;
    watcher.partial = "";
  }
  const available = info.size - watcher.offset;
  if (available <= 0) {
    return;
  }
  const length = Math.min(available, READ_CHUNK_BYTES);
  const handle = await open(watcher.filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, watcher.offset);
    if (bytesRead === 0) {
      return;
    }
    watcher.offset += bytesRead;
    const text =
      watcher.partial + buffer.subarray(0, bytesRead).toString("utf8");
    const lines = text.split("\n");
    watcher.partial = lines.pop() ?? "";
    for (const line of lines) {
      for (const intent of parseLine(line)) {
        enqueueIntent(watcher, intent);
      }
    }
  } finally {
    await handle.close();
  }
}

function enqueueDrain(watcher: IntentWatcher): Promise<void> {
  watcher.drainChain = watcher.drainChain
    .then(() => readAppended(watcher))
    .catch((error: unknown) => {
      if (!watcher.controller.signal.aborted) {
        console.error(
          "paseo-omp-optimize could not read the OMP session",
          error,
        );
      }
    });
  return watcher.drainChain;
}

async function toolCallVisible(
  watcher: IntentWatcher,
  callId: string,
): Promise<boolean> {
  try {
    const page = await watcher.paseo.agents
      .ref(watcher.agentId)
      .timeline.refetch({ direction: "tail", limit: 50 });
    return page.entries.some(
      (entry) =>
        entry.item.type === "tool_call" && entry.item.callId === callId,
    );
  } catch {
    return false;
  }
}

async function waitForToolCall(
  watcher: IntentWatcher,
  callId: string,
): Promise<boolean> {
  const deadline = Date.now() + TOOL_ROW_TIMEOUT_MS;
  while (!watcher.controller.signal.aborted && Date.now() < deadline) {
    if (await toolCallVisible(watcher, callId)) {
      return true;
    }
    try {
      await delay(TOOL_ROW_POLL_INTERVAL_MS, undefined, {
        signal: watcher.controller.signal,
      });
    } catch {
      return false;
    }
  }
  return false;
}

async function publishIntent(
  watcher: IntentWatcher,
  intent: PendingIntent,
): Promise<void> {
  if (!(await waitForToolCall(watcher, intent.callId))) {
    return;
  }
  const item = {
    type: "plugin" as const,
    id: `intent:${intent.callId}`,
    kind: INTENT_KIND,
    version: INTENT_VERSION,
    sequence: "tool" as const,
    data: { callId: intent.callId, intent: intent.intent },
  };
  await watcher.paseo.agents.ref(watcher.agentId).timeline.append(item);
}

function enqueueIntent(watcher: IntentWatcher, intent: PendingIntent): void {
  if (watcher.seen.has(intent.callId)) {
    return;
  }
  watcher.seen.add(intent.callId);
  watcher.publishChain = watcher.publishChain
    .then(() => publishIntent(watcher, intent))
    .catch((error: unknown) => {
      if (!watcher.controller.signal.aborted) {
        console.error(
          "paseo-omp-optimize could not publish an OMP intent",
          error,
        );
      }
    });
}

async function runWatcher(watcher: IntentWatcher): Promise<void> {
  while (!watcher.controller.signal.aborted) {
    await enqueueDrain(watcher);
    if (watcher.stopping) {
      return;
    }
    try {
      await delay(POLL_INTERVAL_MS, undefined, {
        signal: watcher.controller.signal,
      });
    } catch {
      return;
    }
  }
}

interface StartWatcherOptions {
  filePathHint?: string;
  startAt?: "beginning" | "turn" | "end";
}

async function startWatcher(
  agentId: string,
  provider: string,
  paseo: Paseo,
  watchers: Map<string, IntentWatcher>,
  options: StartWatcherOptions = {},
): Promise<void> {
  if (provider !== "omp" || watchers.has(agentId)) {
    return;
  }
  try {
    const filePath =
      options.filePathHint ??
      (await paseo.agents.ref(agentId).refresh())?.agent.persistence
        ?.nativeHandle;
    if (!filePath || !isAbsolute(filePath)) {
      return;
    }
    let offset: number | null;
    switch (options.startAt ?? "end") {
      case "beginning":
        offset = 0;
        break;
      case "turn":
        try {
          offset = await findTurnStartOffset(filePath);
        } catch {
          offset = null;
        }
        if (offset === null) {
          try {
            offset = (await stat(filePath)).size;
          } catch {
            offset = null;
          }
        }
        break;
      case "end":
        try {
          const info = await stat(filePath);
          offset = info.isFile() ? info.size : null;
        } catch {
          offset = null;
        }
        break;
    }
    if (watchers.has(agentId)) {
      return;
    }
    const watcher: IntentWatcher = {
      agentId,
      filePath,
      paseo,
      offset,
      partial: "",
      seen: new Set(),
      controller: new AbortController(),
      stopping: false,
      drainChain: Promise.resolve(),
      publishChain: Promise.resolve(),
      run: Promise.resolve(),
    };
    watchers.set(agentId, watcher);
    watcher.run = runWatcher(watcher).catch((error: unknown) => {
      console.error("paseo-omp-optimize intent watcher stopped", error);
    });
  } catch (error) {
    console.error("paseo-omp-optimize could not watch the OMP session", error);
  }
}

async function finishWatcher(
  agentId: string,
  watchers: Map<string, IntentWatcher>,
): Promise<void> {
  const watcher = watchers.get(agentId);
  if (!watcher) {
    return;
  }
  watchers.delete(agentId);
  watcher.stopping = true;
  await enqueueDrain(watcher);
  await watcher.publishChain;
  watcher.controller.abort();
  await watcher.run;
}

export function contributeIntent(server: PluginServerContext) {
  const watchers = new Map<string, IntentWatcher>();
  server.handle(syncIntentWatchersRpc, async (_input, { paseo }) => {
    const list = await paseo.agents.list({
      scope: "active",
      filter: { statuses: ["running", "idle"] },
    });
    await Promise.all(
      list.entries.map((entry) =>
        startWatcher(entry.agent.id, entry.agent.provider, paseo, watchers, {
          filePathHint: entry.agent.persistence?.nativeHandle,
          startAt: entry.agent.status === "running" ? "turn" : "end",
        }),
      ),
    );
    return {};
  });
  const cleanups = [
    server.on("agent.created", (event, { paseo }) =>
      startWatcher(event.agent.id, event.agent.provider, paseo, watchers, {
        startAt: "beginning",
      }),
    ),
    server.on("agent.turn_started", (event, { paseo }) => {
      if (watchers.has(event.agent.id)) {
        return;
      }
      return startWatcher(
        event.agent.id,
        event.agent.provider,
        paseo,
        watchers,
        { startAt: "turn" },
      );
    }),
    server.on("agent.closed", (event) =>
      finishWatcher(event.agent.id, watchers),
    ),
    server.on("agent.archived", (event) =>
      finishWatcher(event.agent.id, watchers),
    ),
  ];
  return async () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
    await Promise.all(
      [...watchers.keys()].map((agentId) => finishWatcher(agentId, watchers)),
    );
  };
}
