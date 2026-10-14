import { spawnProcess, terminateProcess } from "@getpaseo/plugin/server";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { z } from "zod";
import type { SyncErrorCode } from "../shared/contracts";

export const OB_EXIT_CODES = {
  noConfiguration: 3,
  keyMissing: 2,
  failed: 1,
} as const;

export interface ObLocation {
  path: string;
  source: "override" | "path";
}

export interface ObRun {
  code: number | null;
  stdout: string;
  stderr: string;
  failure: string | null;
}

export interface ObVault {
  id: string;
  name: string;
  region: string;
}

export interface ObConfig {
  mode: "bidirectional" | "pull-only" | "mirror-remote";
  configs: string[];
}

async function searchPath(name: string): Promise<string | null> {
  const names =
    process.platform === "win32"
      ? [`${name}.cmd`, `${name}.exe`, name]
      : [name];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    for (const candidate of names) {
      const path = join(directory, candidate);
      try {
        await access(path, constants.X_OK);
        return path;
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function resolveBinary(
  override: string,
  fallback: string,
): Promise<ObLocation | null> {
  const trimmed = override.trim();
  if (trimmed && (trimmed.includes("/") || isAbsolute(trimmed))) {
    try {
      await access(trimmed, constants.X_OK);
      return { path: trimmed, source: "override" };
    } catch {
      return null;
    }
  }
  const found = await searchPath(trimmed || fallback);
  return found ? { path: found, source: trimmed ? "override" : "path" } : null;
}

export function runOb(
  binary: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs?: number; cwd?: string },
): Promise<ObRun> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const { promise, resolve } = Promise.withResolvers<ObRun>();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnProcess(binary, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: "pipe",
    });
  } catch (error) {
    resolve({
      code: null,
      stdout: "",
      stderr: "",
      failure: error instanceof Error ? error.message : String(error),
    });
    return promise;
  }
  let stdout = "";
  let stderr = "";
  let failure: string | null = null;
  let settled = false;
  const limit = 1 << 20;
  const timer = setTimeout(() => {
    failure = `Timed out after ${String(timeoutMs)}ms`;
    terminateProcess(child).catch(console.error);
  }, timeoutMs);
  child.stdout.on("data", (chunk: Buffer) => {
    if (stdout.length < limit) stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < limit) stderr += chunk.toString();
  });
  child.on("error", (error) => {
    failure ??= error.message;
  });
  child.on("close", (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({ code, stdout, stderr, failure });
  });
  return promise;
}

export function atLeast(version: string, minimum: string): boolean {
  const left = version.split(".").map((part) => Number.parseInt(part, 10));
  const right = minimum.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (Number.isNaN(a)) return false;
    if (a !== b) return a > b;
  }
  return true;
}

export async function probeOb(binary: string): Promise<string | null> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.OBSIDIAN_AUTH_TOKEN;
  const result = await runOb(binary, ["--version"], { env, timeoutMs: 15000 });
  const line = result.stdout.trim().split("\n").at(-1)?.trim() ?? "";
  return result.code === 0 && /^\d+\.\d+\.\d+$/.test(line) ? line : null;
}

export function childEnv(
  token: string | null,
  configHome: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
  };
  if (token) env.OBSIDIAN_AUTH_TOKEN = token;
  else delete env.OBSIDIAN_AUTH_TOKEN;
  return env;
}

function jsonValue(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate =
    start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

const remotesSchema = z.object({
  vaults: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      region: z.string().default(""),
    }),
  ),
  shared: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        region: z.string().default(""),
      }),
    )
    .default([]),
});

const configSchema = z.object({
  syncMode: z.string().optional(),
  configs: z.array(z.string()).default([]),
});

export function parseRemotes(text: string): ObVault[] | null {
  const parsed = remotesSchema.safeParse(jsonValue(text));
  if (!parsed.success) return null;
  return [...parsed.data.vaults, ...parsed.data.shared];
}

export function parseConfig(text: string): ObConfig | null {
  const parsed = configSchema.safeParse(jsonValue(text));
  if (!parsed.success) return null;
  const mode =
    parsed.data.syncMode === "pull-only" ||
    parsed.data.syncMode === "mirror-remote"
      ? parsed.data.syncMode
      : "bidirectional";
  return { mode, configs: parsed.data.configs };
}

export function redact(text: string, token: string | null): string {
  return token ? text.split(token).join("[redacted]") : text;
}

export function lastLine(text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? "").slice(0, 300);
}

export function classifyFailure(
  text: string,
  token: string | null,
): { code: SyncErrorCode; message: string | null } {
  const safe = redact(text, token);
  if (/another sync instance is already running/i.test(safe))
    return { code: "lock_held", message: null };
  if (
    /failed to authenticate|http error 40[13]|unauthorized|invalid token/i.test(
      safe,
    )
  )
    return { code: "token_invalid", message: null };
  if (/vault not found|no longer exists|http error 404/i.test(safe))
    return { code: "vault_missing", message: null };
  if (
    /fetch failed|enotfound|econnrefused|etimedout|eai_again|unable to connect to server|socket hang up|network/i.test(
      safe,
    )
  )
    return { code: "remote_unreachable", message: lastLine(safe) || null };
  return { code: "sync_failed", message: lastLine(safe) || null };
}
