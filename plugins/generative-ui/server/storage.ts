import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cardSchema, objectSchema } from "../shared/protocol";

const eventSchema = z
  .object({
    agentId: z.string(),
    cardId: z.string(),
    eventId: z.string(),
    revision: z.number(),
    values: objectSchema,
    messageId: z.string(),
    delivery: z.enum(["queued", "sent"]),
  })
  .strict();
export type Submission = z.infer<typeof eventSchema>;
const storedCardSchema = z
  .object({ agentId: z.string(), card: cardSchema })
  .strict();
const databaseSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(0).max(65535),
    sessions: z.array(
      z.object({ token: z.string(), agentId: z.string().nullable() }).strict(),
    ),
    cards: z.array(storedCardSchema),
    events: z.array(eventSchema),
  })
  .strict();
export type Database = z.infer<typeof databaseSchema>;

export class Storage {
  private readonly directory = join(
    process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
    "plugin-data",
    "generative-ui",
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
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return { version: 1, port: 0, sessions: [], cards: [], events: [] };
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
}
