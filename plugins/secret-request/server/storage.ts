import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const sessionSchema = z
  .object({ token: z.string().min(1), agentId: z.string().nullable() })
  .strict();

const databaseSchema = z
  .object({
    version: z.literal(1),
    port: z.number().int().min(0).max(65535),
    handoffId: z.string().min(1),
    sessions: z.array(sessionSchema),
  })
  .strict();

export type Database = z.infer<typeof databaseSchema>;

export class Storage {
  private readonly directory = join(
    process.env.PASEO_HOME ?? join(homedir(), ".paseo"),
    "plugin-data",
    "secret-request",
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
        return {
          version: 1,
          port: 0,
          handoffId: randomUUID(),
          sessions: [],
        };
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
      const result = await operation(database);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(this.path, JSON.stringify(database), { mode: 0o600 });
      return result;
    });
  }
}
