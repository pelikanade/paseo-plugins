import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  rmdir,
  statfs,
  utimes,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { HANDOFF_ROOT_NAME, HANDOFF_TTL_MS } from "../shared/protocol";

const TMPFS_MAGIC = 0x01021994;
const HANDOFF_BASE = "/dev/shm";

export type Handoff =
  | { status: "ready"; root: string }
  | { status: "unavailable"; message: string };

function unavailable(what: string, error: unknown): Handoff {
  const detail = error instanceof Error ? error.message : "Unknown error";
  return { status: "unavailable", message: `${what}: ${detail}` };
}

async function privateDirectory(
  path: string,
  uid: number,
): Promise<string | null> {
  let entry;
  try {
    entry = await lstat(path);
  } catch (error) {
    const missing =
      error instanceof Error && "code" in error && error.code === "ENOENT";
    if (!missing) throw error;
    await mkdir(path, { mode: 0o700 });
    entry = await lstat(path);
  }
  if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== uid)
    return `${path} is not a private directory owned by this user`;
  if ((entry.mode & 0o777) !== 0o700) await chmod(path, 0o700);
  return null;
}

async function privateScopes(uid: number, root: string): Promise<void> {
  const problem =
    (await privateDirectory(dirname(root), uid)) ??
    (await privateDirectory(root, uid));
  if (problem !== null) throw new Error(problem);
  const mounted = await statfs(root);
  if (mounted.type !== TMPFS_MAGIC)
    throw new Error(`${root} is not memory-backed on this host`);
}

export async function prepareHandoff(
  uid: number,
  scope: string,
): Promise<Handoff> {
  try {
    const base = await statfs(HANDOFF_BASE);
    if (base.type !== TMPFS_MAGIC)
      return {
        status: "unavailable",
        message: `${HANDOFF_BASE} is not memory-backed on this host`,
      };
  } catch (error) {
    return unavailable(`${HANDOFF_BASE} is unavailable`, error);
  }
  const root = join(
    HANDOFF_BASE,
    `paseo-${String(uid)}-${HANDOFF_ROOT_NAME}`,
    scope,
  );
  try {
    await privateScopes(uid, root);
    await purge(root);
  } catch (error) {
    return unavailable(`Cannot prepare ${root}`, error);
  }
  return { status: "ready", root };
}

export async function purge(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries)
    await rm(join(root, entry.name), { recursive: true, force: true });
}

export interface SweepResult {
  files: number;
  directories: number;
  failed: number;
  reason: string | null;
}

interface Swept {
  files: number;
  directories: number;
}

async function sweepScope(directory: string, now: number): Promise<Swept> {
  const before = await lstat(directory);
  const swept: Swept = { files: 0, directories: 0 };
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    const stats = await lstat(path);
    if (!stats.isFile() || now - stats.mtimeMs < HANDOFF_TTL_MS) continue;
    await rm(path, { force: true });
    swept.files += 1;
  }
  if (now - before.mtimeMs >= HANDOFF_TTL_MS)
    try {
      await rmdir(directory);
      swept.directories += 1;
    } catch (error) {
      const tolerated =
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTEMPTY");
      if (!tolerated) throw error;
    }
  return swept;
}

export async function sweepExpired(
  uid: number,
  root: string,
): Promise<SweepResult> {
  const base = join(HANDOFF_BASE, `paseo-${String(uid)}-${HANDOFF_ROOT_NAME}`);
  const result: SweepResult = {
    files: 0,
    directories: 0,
    failed: 0,
    reason: null,
  };
  if ((await privateDirectory(base, uid)) !== null) return result;
  const now = Date.now();
  for (const candidate of await readdir(base, { withFileTypes: true })) {
    if (!candidate.isDirectory()) continue;
    const directory = join(base, candidate.name);
    if (directory === root) continue;
    try {
      const swept = await sweepScope(directory, now);
      result.files += swept.files;
      result.directories += swept.directories;
    } catch (error) {
      result.failed += 1;
      result.reason ??=
        error instanceof Error ? error.message : "Unknown error";
    }
  }
  return result;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

export async function refreshScope(
  uid: number,
  root: string,
): Promise<boolean> {
  const created = !(await exists(root));
  await privateScopes(uid, root);
  const now = new Date();
  await utimes(root, now, now);
  return created;
}

export async function writeValue(
  uid: number,
  root: string,
  requestId: string,
  value: string,
): Promise<void> {
  if (await refreshScope(uid, root))
    console.warn(
      `secret-request: the handoff directory ${root} had disappeared and was recreated`,
    );
  const handle = await open(join(root, requestId), "wx", 0o600);
  try {
    const stats = await handle.stat();
    if (stats.uid !== uid || (stats.mode & 0o777) !== 0o600)
      throw new Error("Handoff file permissions are not private");
    await handle.writeFile(value, "utf8");
  } finally {
    await handle.close();
  }
}

export async function deleteValue(
  root: string,
  requestId: string,
): Promise<void> {
  await rm(join(root, requestId), { force: true });
}
