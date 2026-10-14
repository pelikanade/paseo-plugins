import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  statfs,
} from "node:fs/promises";
import { join } from "node:path";
import { HANDOFF_ROOT_NAME } from "../shared/protocol";

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
    const problem =
      (await privateDirectory(
        join(HANDOFF_BASE, `paseo-${String(uid)}-${HANDOFF_ROOT_NAME}`),
        uid,
      )) ?? (await privateDirectory(root, uid));
    if (problem !== null) return { status: "unavailable", message: problem };
    const mounted = await statfs(root);
    if (mounted.type !== TMPFS_MAGIC)
      return {
        status: "unavailable",
        message: `${root} is not memory-backed on this host`,
      };
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

export async function writeValue(
  uid: number,
  root: string,
  requestId: string,
  value: string,
): Promise<void> {
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
