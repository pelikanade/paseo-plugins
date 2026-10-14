import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { SyncErrorCode } from "../shared/contracts";
import { childEnv, classifyFailure, runOb } from "./ob";

export const TOKEN_FILE_MODE = 0o600;
export const DATA_DIR_MODE = 0o700;

export async function readToken(path: string): Promise<string | null> {
  try {
    const token = (await readFile(path, "utf8")).trim();
    return token.length > 0 ? token : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

export async function writeToken(path: string, token: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: DATA_DIR_MODE });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, token, { mode: TOKEN_FILE_MODE });
  await rename(temporary, path);
}

export async function clearToken(path: string): Promise<void> {
  await rm(path, { force: true });
}

export type TokenValidation =
  | { status: "saved"; account: string | null }
  | { status: "rejected" }
  | { status: "error"; code: SyncErrorCode };

export async function validateToken(
  binary: string,
  token: string,
  configHome: string,
): Promise<TokenValidation> {
  const result = await runOb(binary, ["login"], {
    env: childEnv(token, configHome),
    timeoutMs: 30000,
  });
  if (result.code === null) return { status: "error", code: "ob_missing" };
  if (result.code === 0) {
    const match = /Logged in as (.+?)(?: \(([^)]+)\))?$/m.exec(result.stdout);
    return { status: "saved", account: match?.[2] ?? match?.[1] ?? null };
  }
  const failure = classifyFailure(`${result.stderr}\n${result.stdout}`, token);
  if (failure.code === "token_invalid") return { status: "rejected" };
  return { status: "error", code: failure.code };
}
