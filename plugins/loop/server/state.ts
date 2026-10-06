import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const databaseSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(0).max(65535),
    sessions: z.array(
      z.object({ token: z.string(), agentId: z.string().nullable() }).strict(),
    ),
  })
  .strict();
type Database = z.infer<typeof databaseSchema>;

export class State {
  private readonly directory = join(
    process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
    "plugin-data",
    "loop",
  );
  private readonly path = join(this.directory, "state.json");
  private ready: Promise<Database> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  private async load(): Promise<Database> {
    try {
      return databaseSchema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return { version: 1, port: 0, sessions: [] };
      throw error;
    }
  }

  read<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
    const run = async () => operation(await (this.ready ??= this.load()));
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  change<T>(operation: (database: Database) => T | Promise<T>): Promise<T> {
    return this.read(async (database) => {
      const draft = databaseSchema.parse(JSON.parse(JSON.stringify(database)));
      const result = await operation(draft);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(draft), { mode: 0o600 });
      await rename(temporary, this.path);
      Object.assign(database, draft);
      return result;
    });
  }

  open(agentId: string | null) {
    return this.change((database) => {
      const existing = agentId
        ? database.sessions.find((item) => item.agentId === agentId)
        : undefined;
      if (existing) return existing.token;
      if (database.sessions.length >= 1000)
        throw new Error("Session storage is full");
      const token = randomUUID();
      database.sessions.push({ token, agentId });
      return token;
    });
  }

  bind(token: string, agentId: string) {
    return this.change((database) => {
      const entry = database.sessions.find(
        (session) => session.token === token,
      );
      if (!entry || (entry.agentId !== null && entry.agentId !== agentId))
        throw new Error("Invalid loop session");
      entry.agentId = agentId;
    });
  }

  authorize(token: string) {
    return this.read(
      (database) =>
        database.sessions.find((session) => session.token === token)?.agentId ??
        null,
    );
  }

  forget(agentId: string) {
    return this.change((database) => {
      database.sessions = database.sessions.filter(
        (entry) => entry.agentId !== agentId,
      );
    });
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error))
    return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
