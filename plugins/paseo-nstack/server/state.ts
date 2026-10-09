import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  activitySchema,
  attentionSchema,
  bindingSchema,
  countsSchema,
  healthSchema,
  pluginDefaultsSchema,
  signalKindSchema,
  type Activity,
} from "../shared/contracts";

const signalSchema = z
  .object({
    key: z.string().min(1).max(1000),
    kind: signalKindSchema,
    subject: z.string(),
    url: z.url().nullable(),
    observedAt: z.iso.datetime(),
    actor: z.string().nullable(),
    data: z.record(z.string(), z.string()),
  })
  .strict();
export type Signal = z.infer<typeof signalSchema>;

const launchSchema = z
  .object({
    key: z.string(),
    workspaceId: z.string(),
    agentId: z.string(),
    idempotencyKey: z.string(),
    state: z.enum(["pending", "started", "failed", "blocked"]),
    signal: signalSchema,
    error: z.string().nullable(),
    attempts: z.number().int().nonnegative().default(0),
    retryAt: z.iso.datetime().nullable().default(null),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Launch = z.infer<typeof launchSchema>;

const workspaceSchema = z
  .object({
    workspaceId: z.string(),
    initialized: z.boolean(),
    cursors: z.record(z.string(), z.string()),
    nextRepairAt: z.iso.datetime().nullable(),
    health: healthSchema,
    counts: countsSchema,
    attention: z.array(attentionSchema),
  })
  .strict();
export type WorkspaceState = z.infer<typeof workspaceSchema>;

const databaseSchema = z
  .object({
    version: z.literal(1),
    defaults: pluginDefaultsSchema,
    recoveryMessage: z.string().nullable().default(null),
    bindings: z.array(bindingSchema),
    workspaces: z.array(workspaceSchema),
    pending: z.array(signalSchema.extend({ workspaceId: z.string() }).strict()),
    launches: z.array(launchSchema),
    activity: z.array(
      activitySchema.extend({ workspaceId: z.string() }).strict(),
    ),
  })
  .strict();
export type Database = z.infer<typeof databaseSchema>;
const MAX_PENDING_PER_WORKSPACE = 5_000;
const MAX_LAUNCHES_PER_WORKSPACE = 50_000;
const MAX_CURSORS_PER_WORKSPACE = 50_000;

function requireBoundedState(database: Database, previous: Database) {
  const pending = new Map<string, number>();
  const previousPending = new Map<string, number>();
  const launches = new Map<string, number>();
  const previousLaunches = new Map<string, number>();
  for (const signal of database.pending)
    pending.set(signal.workspaceId, (pending.get(signal.workspaceId) ?? 0) + 1);
  for (const signal of previous.pending)
    previousPending.set(
      signal.workspaceId,
      (previousPending.get(signal.workspaceId) ?? 0) + 1,
    );
  for (const launch of database.launches)
    launches.set(
      launch.workspaceId,
      (launches.get(launch.workspaceId) ?? 0) + 1,
    );
  for (const launch of previous.launches)
    previousLaunches.set(
      launch.workspaceId,
      (previousLaunches.get(launch.workspaceId) ?? 0) + 1,
    );
  for (const [workspaceId, count] of pending)
    if (
      count > MAX_PENDING_PER_WORKSPACE &&
      count > (previousPending.get(workspaceId) ?? 0)
    )
      throw new Error(
        `Workspace ${workspaceId} has too many paused signals; resume or rebind it`,
      );
  for (const [workspaceId, count] of launches)
    if (
      count > MAX_LAUNCHES_PER_WORKSPACE &&
      count > (previousLaunches.get(workspaceId) ?? 0)
    )
      throw new Error(
        `Workspace ${workspaceId} launch history is full; rebind it to reset exact-duplicate history`,
      );
  for (const workspace of database.workspaces) {
    const previousWorkspace = previous.workspaces.find(
      (candidate) => candidate.workspaceId === workspace.workspaceId,
    );
    const count = Object.keys(workspace.cursors).length;
    if (
      count > MAX_CURSORS_PER_WORKSPACE &&
      count > Object.keys(previousWorkspace?.cursors ?? {}).length
    )
      throw new Error(
        `Workspace ${workspace.workspaceId} has too many GitHub cursors; rebind it`,
      );
  }
}

const emptyCounts = {
  ready: 0,
  building: 0,
  reviewing: 0,
  mergeQueue: 0,
  needsYou: 0,
};

function emptyDatabase(): Database {
  return {
    version: 1,
    defaults: { automaticStarts: true, agent: null },
    recoveryMessage: null,
    bindings: [],
    workspaces: [],
    pending: [],
    launches: [],
    activity: [],
  };
}

export function initialWorkspaceState(workspaceId: string): WorkspaceState {
  return {
    workspaceId,
    initialized: false,
    cursors: {},
    nextRepairAt: null,
    health: {
      state: "waiting",
      message: "Waiting for Paseo",
      login: null,
      lastCheckedAt: null,
      nextCheckAt: null,
    },
    counts: { ...emptyCounts },
    attention: [],
  };
}

export function workspaceState(
  database: Database,
  workspaceId: string,
): WorkspaceState {
  const existing = database.workspaces.find(
    (candidate) => candidate.workspaceId === workspaceId,
  );
  if (existing) return existing;
  const workspace = initialWorkspaceState(workspaceId);
  database.workspaces.push(workspace);
  return workspace;
}

export function appendActivity(
  database: Database,
  workspaceId: string,
  activity: Omit<Activity, "id">,
  id: string = randomUUID(),
) {
  if (
    database.activity.some(
      (entry) => entry.workspaceId === workspaceId && entry.id === id,
    )
  )
    return;
  database.activity.unshift({ ...activity, id, workspaceId });
  let retained = 0;
  database.activity = database.activity.filter((entry) => {
    if (entry.workspaceId !== workspaceId) return true;
    retained += 1;
    return retained <= 200;
  });
}

export function createState() {
  const directory = join(
    process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
    "plugin-data",
    "paseo-nstack",
  );
  const path = join(directory, "state.json");
  let ready: Promise<Database> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  async function load() {
    let serialized: string;
    try {
      serialized = await readFile(path, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return emptyDatabase();
      throw error;
    }
    try {
      return databaseSchema.parse(JSON.parse(serialized));
    } catch (error) {
      if (!(error instanceof SyntaxError || error instanceof z.ZodError))
        throw error;
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const quarantine = `state.json.corrupt-${Date.now().toString()}-${randomUUID()}`;
      await rename(path, join(directory, quarantine));
      const database = emptyDatabase();
      database.recoveryMessage = `Saved watcher state was invalid and moved to ${quarantine}`;
      return database;
    }
  }

  async function loadedState() {
    const request = ready ?? load();
    ready = request;
    try {
      return await request;
    } catch (error) {
      if (ready === request) ready = undefined;
      throw error;
    }
  }

  function read<T>(
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T> {
    const run = async () => operation(await loadedState());
    const result = queue.then(run, run);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function change<T>(
    operation: (database: Database) => T | Promise<T>,
  ): Promise<T> {
    return read(async (database) => {
      const draft = databaseSchema.parse(structuredClone(database));
      const result = await operation(draft);
      draft.recoveryMessage = null;
      requireBoundedState(draft, database);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(draft), { mode: 0o600 });
      await rename(temporary, path);
      Object.assign(database, draft);
      return result;
    });
  }

  return { directory, read, change };
}
