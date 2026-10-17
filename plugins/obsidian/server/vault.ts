import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

interface VaultEntry {
  path: string;
  name: string;
  type: "file" | "folder";
  size: number;
  modifiedAt: string;
}

export const DENIED_SEGMENTS = [".obsidian", ".trash", "Trash"];
const LIST_LIMIT = 1000;
export const GLOB_LIMIT = 200;
export const GREP_MATCH_LIMIT = 100;
const GREP_BYTES_LIMIT = 200 * 1024;
const GREP_SCAN_LIMIT = 64 * 1024 * 1024;
const GREP_FILE_LIMIT = 2 * 1024 * 1024;
export const TOOL_READ_LIMIT = 256 * 1024;
const WALK_LIMIT = 20000;
const BINARY_SNIFF = 8192;

export function vaultPath(dataRoot: string): string {
  return join(dataRoot, "vault");
}

function denied(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((segment) => DENIED_SEGMENTS.includes(segment));
}

type Jail =
  | { status: "ok"; path: string; relative: string }
  | { status: "denied" }
  | { status: "not_found" };

async function jail(root: string, input: string): Promise<Jail> {
  const cleaned = input.replace(/^\/+/, "");
  if (input.includes("\0")) return { status: "denied" };
  if (cleaned.split("/").some((segment) => segment === ".."))
    return { status: "denied" };
  if (denied(cleaned)) return { status: "denied" };
  const canonicalRoot = await realpath(root).catch(() => null);
  if (!canonicalRoot) return { status: "not_found" };
  const canonical = await realpath(resolve(canonicalRoot, cleaned)).catch(
    () => null,
  );
  if (!canonical) return { status: "not_found" };
  if (
    canonical !== canonicalRoot &&
    !canonical.startsWith(`${canonicalRoot}${sep}`)
  )
    return { status: "denied" };
  const rest = relative(canonicalRoot, canonical);
  return {
    status: "ok",
    path: canonical,
    relative: rest.split(sep).join("/"),
  };
}

export async function vaultExists(root: string): Promise<boolean> {
  const info = await stat(root).catch(() => null);
  return info?.isDirectory() ?? false;
}

interface VaultFile {
  path: string;
  absolute: string;
  size: number;
  modifiedAt: string;
}

interface WalkResult {
  files: VaultFile[];
  truncated: boolean;
}

export async function walkFiles(
  root: string,
  limit = WALK_LIMIT,
): Promise<WalkResult> {
  const canonicalRoot = await realpath(root).catch(() => null);
  if (!canonicalRoot) return { files: [], truncated: false };
  const files: VaultFile[] = [];
  let truncated = false;
  const queue: string[] = [""];
  while (queue.length > 0) {
    const directory = queue.shift() ?? "";
    const entries = await readdir(
      directory ? join(canonicalRoot, directory) : canonicalRoot,
      { withFileTypes: true },
    ).catch(() => []);
    for (const entry of entries) {
      if (DENIED_SEGMENTS.includes(entry.name)) continue;
      const child = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        queue.push(child);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (files.length >= limit) {
        truncated = true;
        return { files, truncated };
      }
      const located: Jail = entry.isSymbolicLink()
        ? await jail(canonicalRoot, child)
        : { status: "ok", path: join(canonicalRoot, child), relative: child };
      if (located.status !== "ok") continue;
      const info = await stat(located.path).catch(() => null);
      if (!info?.isFile()) continue;
      files.push({
        path: child,
        absolute: located.path,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }
  }
  return { files, truncated };
}

export async function listVault(
  root: string,
  input: string,
  depth = 1,
): Promise<
  | { status: "ok"; entries: VaultEntry[]; truncated: boolean }
  | { status: "path_denied" | "not_found" }
> {
  const located = await jail(root, input);
  if (located.status === "denied") return { status: "path_denied" };
  if (located.status === "not_found") return { status: "not_found" };
  const info = await stat(located.path).catch(() => null);
  if (!info) return { status: "not_found" };
  if (!info.isDirectory()) return { status: "not_found" };
  const prefix = located.relative;
  const entries: VaultEntry[] = [];
  let truncated = false;
  const walk = async (directory: string, remaining: number) => {
    if (truncated || remaining < 1) return;
    const children = await readdir(join(located.path, directory), {
      withFileTypes: true,
    }).catch(() => []);
    const sorted = children
      .filter((entry) => !DENIED_SEGMENTS.includes(entry.name))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory())
          return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
    for (const entry of sorted) {
      if (entries.length >= LIST_LIMIT) {
        truncated = true;
        return;
      }
      const child = directory ? `${directory}/${entry.name}` : entry.name;
      const rootRelative = prefix ? `${prefix}/${child}` : child;
      const childInfo = await stat(join(located.path, child)).catch(() => null);
      if (!childInfo) continue;
      if (entry.isDirectory()) {
        entries.push({
          path: rootRelative,
          name: entry.name,
          type: "folder",
          size: 0,
          modifiedAt: childInfo.mtime.toISOString(),
        });
        await walk(child, remaining - 1);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if ((await jail(root, rootRelative)).status !== "ok") continue;
      if (!childInfo.isFile()) continue;
      entries.push({
        path: rootRelative,
        name: entry.name,
        type: "file",
        size: childInfo.size,
        modifiedAt: childInfo.mtime.toISOString(),
      });
    }
  };
  await walk("", depth);
  return { status: "ok", entries, truncated };
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  let out = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        const withSlash = normalized[index + 2] === "/";
        out += withSlash ? "(?:.*/)?" : ".*";
        index += withSlash ? 2 : 1;
      } else out += "[^/]*";
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    if (char === "[") {
      const end = normalized.indexOf("]", index + 1);
      if (end > index) {
        out += normalized.slice(index, end + 1);
        index = end;
        continue;
      }
    }
    if (char === "{") {
      const end = normalized.indexOf("}", index + 1);
      if (end > index) {
        out += `(?:${normalized
          .slice(index + 1, end)
          .split(",")
          .map(escapeLiteral)
          .join("|")})`;
        index = end;
        continue;
      }
    }
    out += escapeLiteral(char);
  }
  return new RegExp(`^${out}$`);
}

export async function globVault(
  root: string,
  pattern: string,
  limit = GLOB_LIMIT,
): Promise<{ paths: string[]; truncated: boolean }> {
  const matcher = globToRegExp(pattern);
  const walked = await walkFiles(root, WALK_LIMIT);
  const paths = walked.files
    .map((file) => file.path)
    .filter((path) => matcher.test(path));
  return {
    paths: paths.slice(0, limit),
    truncated: walked.truncated || paths.length > limit,
  };
}

interface GrepOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  include?: string;
  limit?: number;
}

interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export async function grepVault(
  root: string,
  query: string,
  options: GrepOptions = {},
): Promise<{ matches: GrepMatch[]; truncated: boolean }> {
  const limit = options.limit ?? GREP_MATCH_LIMIT;
  const include = options.include ? globToRegExp(options.include) : null;
  const needle = options.caseSensitive ? query : query.toLowerCase();
  const matcher = options.regex
    ? new RegExp(query, options.caseSensitive ? "" : "i")
    : null;
  const walked = await walkFiles(root, WALK_LIMIT);
  const matches: GrepMatch[] = [];
  let truncated = walked.truncated;
  let scanned = 0;
  let bytes = 0;
  for (const file of walked.files) {
    if (matches.length >= limit || bytes >= GREP_BYTES_LIMIT) {
      truncated = true;
      break;
    }
    if (include && !include.test(file.path)) continue;
    if (file.size > GREP_FILE_LIMIT) continue;
    scanned += file.size;
    if (scanned > GREP_SCAN_LIMIT) {
      truncated = true;
      break;
    }
    const content = await readFile(file.absolute).catch(() => null);
    if (!content) continue;
    if (content.subarray(0, BINARY_SNIFF).includes(0)) continue;
    const lines = content.toString("utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index];
      const hit = matcher
        ? matcher.test(text)
        : (options.caseSensitive ? text : text.toLowerCase()).includes(needle);
      if (!hit) continue;
      if (matches.length >= limit || bytes >= GREP_BYTES_LIMIT) {
        truncated = true;
        break;
      }
      matches.push({
        path: file.path,
        line: index + 1,
        text: text.slice(0, 500),
      });
      bytes += text.length;
    }
  }
  return { matches, truncated };
}

type ReadResult =
  | {
      status: "ok";
      path: string;
      text: string;
      truncated: boolean;
      bytes: number;
      modifiedAt: string;
    }
  | {
      status: "error";
      code: "path_denied" | "binary_file" | "not_found";
      bytes: number;
      modifiedAt: string | null;
    };

export async function readVault(
  root: string,
  input: string,
  maxBytes = TOOL_READ_LIMIT,
  offset = 0,
): Promise<ReadResult> {
  const located = await jail(root, input);
  if (located.status === "denied")
    return { status: "error", code: "path_denied", bytes: 0, modifiedAt: null };
  if (located.status === "not_found")
    return { status: "error", code: "not_found", bytes: 0, modifiedAt: null };
  const info = await stat(located.path).catch(() => null);
  if (!info?.isFile())
    return { status: "error", code: "not_found", bytes: 0, modifiedAt: null };
  const start = Math.max(0, Math.min(offset, info.size));
  const length = Math.max(0, Math.min(maxBytes, info.size - start));
  const handle = await open(located.path, "r");
  const view = await (async () => {
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  })();
  const modifiedAt = info.mtime.toISOString();
  if (view.subarray(0, BINARY_SNIFF).includes(0))
    return {
      status: "error",
      code: "binary_file",
      bytes: info.size,
      modifiedAt,
    };
  return {
    status: "ok",
    path: located.relative,
    text: new TextDecoder("utf-8", { fatal: false }).decode(view),
    truncated: start + view.length < info.size,
    bytes: info.size,
    modifiedAt,
  };
}
