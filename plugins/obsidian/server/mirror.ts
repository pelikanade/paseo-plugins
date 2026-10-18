import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { DENIED_SEGMENTS, readVault, TOOL_READ_LIMIT } from "./vault";
import { discoverSkillPaths, frontMatter, SKILLS_DIRECTORY } from "./injection";

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESOURCE_BYTES_LIMIT = 1024 * 1024;
const SKILL_BYTES_LIMIT = 8 * 1024 * 1024;

const manifestSchema = z
  .object({
    version: z.literal(1),
    skills: z.record(
      z.string(),
      z.object({ files: z.record(z.string(), z.string()) }).strict(),
    ),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;

interface MirrorOptions {
  sourceRoot: string;
  skillsRoot: string;
  manifestPath: string;
}

interface DesiredSkill {
  files: Map<string, Buffer>;
}

function emptyManifest(): Manifest {
  return { version: 1, skills: {} };
}

function digest(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function isSafeRelative(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  );
}

async function readManifest(path: string): Promise<Manifest> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) return emptyManifest();
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = manifestSchema.safeParse(parsed);
    return result.success ? result.data : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

async function writeManifest(path: string, manifest: Manifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest)}\n`);
  await rename(temporary, path);
}

async function prune(directory: string, keep: boolean): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    if (entry.isDirectory()) await prune(join(directory, entry.name), false);
  }
  if (keep) return;
  const remaining = await readdir(directory).catch(() => []);
  if (remaining.length === 0) await rmdir(directory).catch(() => undefined);
}

export class SkillMirror {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: MirrorOptions) {}

  reconcile(): Promise<void> {
    const run = () => this.apply();
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  clear(): Promise<void> {
    const run = () => this.removeAll();
    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async apply(): Promise<void> {
    const desired = await this.desired();
    const previous = await readManifest(this.options.manifestPath);
    const next = emptyManifest();
    for (const [name, entry] of Object.entries(previous.skills)) {
      if (!desired.has(name)) await this.remove(name, entry.files);
    }
    await mkdir(this.options.skillsRoot, { recursive: true });
    for (const [name, skill] of desired) {
      const target = join(this.options.skillsRoot, name);
      const owned = Object.hasOwn(previous.skills, name)
        ? previous.skills[name]
        : undefined;
      const targetInfo = await lstat(target).catch(() => null);
      if (
        targetInfo !== null &&
        (owned === undefined || !targetInfo.isDirectory())
      )
        continue;
      const previousFiles = owned?.files ?? {};
      const nextFiles: Record<string, string> = {};
      for (const [relative, content] of skill.files) {
        if (!isSafeRelative(relative)) continue;
        const filePath = join(target, relative);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content);
        nextFiles[relative] = digest(content);
      }
      for (const [relative, previousDigest] of Object.entries(previousFiles)) {
        if (!isSafeRelative(relative) || skill.files.has(relative)) continue;
        const filePath = join(target, relative);
        const current = await readFile(filePath).catch(() => null);
        if (current !== null && digest(current) === previousDigest)
          await rm(filePath, { force: true });
      }
      await prune(target, true);
      next.skills[name] = { files: nextFiles };
    }
    await writeManifest(this.options.manifestPath, next);
  }

  private async removeAll(): Promise<void> {
    const previous = await readManifest(this.options.manifestPath);
    for (const [name, entry] of Object.entries(previous.skills)) {
      await this.remove(name, entry.files);
    }
    if (Object.keys(previous.skills).length > 0)
      await writeManifest(this.options.manifestPath, emptyManifest());
    else await rm(this.options.manifestPath, { force: true });
  }

  private async remove(
    name: string,
    files: Record<string, string>,
  ): Promise<void> {
    if (!SKILL_NAME.test(name)) return;
    const target = join(this.options.skillsRoot, name);
    const info = await lstat(target).catch(() => null);
    if (info === null || !info.isDirectory()) return;
    for (const [relative, previousDigest] of Object.entries(files)) {
      if (!isSafeRelative(relative)) continue;
      const filePath = join(target, relative);
      const current = await readFile(filePath).catch(() => null);
      if (current !== null && digest(current) === previousDigest)
        await rm(filePath, { force: true });
    }
    await prune(target, false);
  }

  private async desired(): Promise<Map<string, DesiredSkill>> {
    const desired = new Map<string, DesiredSkill>();
    for (const path of await discoverSkillPaths(this.options.sourceRoot)) {
      const source = await readVault(
        this.options.sourceRoot,
        path,
        TOOL_READ_LIMIT,
      );
      if (source.status !== "ok" || source.truncated) continue;
      const meta = frontMatter(source.text);
      if (!meta.name || !meta.description || !SKILL_NAME.test(meta.name))
        continue;
      if (desired.has(meta.name)) continue;
      const files = await this.filesFor(path);
      if (!files.has("SKILL.md")) continue;
      desired.set(meta.name, { files });
    }
    return desired;
  }

  private async filesFor(path: string): Promise<Map<string, Buffer>> {
    const directory = path.slice(0, path.lastIndexOf("/"));
    if (directory === SKILLS_DIRECTORY) {
      const content = await readFile(join(this.options.sourceRoot, path)).catch(
        () => null,
      );
      if (content === null || content.byteLength > TOOL_READ_LIMIT)
        return new Map();
      return new Map([["SKILL.md", content]]);
    }
    const rootFile = await readFile(join(this.options.sourceRoot, path)).catch(
      () => null,
    );
    if (rootFile === null || rootFile.byteLength > TOOL_READ_LIMIT)
      return new Map();
    const files = new Map<string, Buffer>([["SKILL.md", rootFile]]);
    const state = { total: rootFile.byteLength };
    await this.collect(directory, "", files, state);
    return files;
  }

  private async collect(
    directory: string,
    prefix: string,
    files: Map<string, Buffer>,
    state: { total: number },
  ): Promise<void> {
    const entries = await readdir(join(this.options.sourceRoot, directory), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (DENIED_SEGMENTS.includes(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      if (prefix === "" && entry.name === "SKILL.md") continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.collect(
          `${directory}/${entry.name}`,
          relative,
          files,
          state,
        );
        continue;
      }
      if (!entry.isFile()) continue;
      const content = await readFile(
        join(this.options.sourceRoot, directory, entry.name),
      ).catch(() => null);
      if (content === null || content.byteLength > RESOURCE_BYTES_LIMIT)
        continue;
      state.total += content.byteLength;
      if (state.total > SKILL_BYTES_LIMIT) continue;
      files.set(relative, content);
    }
  }
}
