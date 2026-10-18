import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { InjectionFile } from "../shared/contracts";
import { DENIED_SEGMENTS, readVault } from "./vault";

const INJECTION_BYTES_LIMIT = 32 * 1024;
const SKILL_FILE_NAME = "SKILL.md";
export const SKILLS_DIRECTORY = "Skills";

export const INJECTION_INSTRUCTIONS =
  'The Obsidian vault reached through the obsidian MCP server is read-only: list_vault, glob_vault, grep_vault and read_vault. Its skills are Markdown files in the vault\'s Skills folder with name and description front matter: a skill folder\'s SKILL.md or a Skills/*.md file. List them with glob_vault "Skills/**/SKILL.md" and glob_vault "Skills/*.md", and read a skill with read_vault before using it. Use read_vault to open a note before relying on it, and prefer grep_vault to find the right note. Every result carries lastSyncedAt and stale; when stale is true the local copy may be behind the remote. Paths are vault-relative, and .obsidian and the trash folders are not readable.';

interface InjectionState {
  skills: InjectionFile[];
  block: string;
}

export function frontMatter(text: string): {
  name?: string;
  description?: string;
} {
  if (!text.startsWith("---")) return {};
  const start = text.indexOf("\n");
  const end = text.indexOf("\n---", 3);
  if (start < 0 || end < start) return {};
  const meta: { name?: string; description?: string } = {};
  const lines = text.slice(start + 1, end).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || line.startsWith(" ") || line.startsWith("\t")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (key !== "name" && key !== "description") continue;
    const raw = line.slice(separator + 1).trim();
    if (!/^[|>][+-]?$/.test(raw)) {
      const value = raw.replace(/^["']|["']$/g, "");
      if (value) meta[key] = value;
      continue;
    }
    const parts: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (next.trim() === "") {
        cursor += 1;
        continue;
      }
      if (!next.startsWith(" ") && !next.startsWith("\t")) break;
      parts.push(next.trim());
      cursor += 1;
    }
    index = cursor - 1;
    const value = parts.join(" ").replace(/\s+/g, " ").trim();
    if (value) meta[key] = value;
  }
  return meta;
}

function isSkillPath(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  const separator = path.lastIndexOf("/");
  const directory = path.slice(0, separator);
  const name = path.slice(separator + 1);
  return name === SKILL_FILE_NAME || directory === SKILLS_DIRECTORY;
}

export async function discoverSkillPaths(root: string): Promise<string[]> {
  const found: string[] = [];
  const queue: string[] = [SKILLS_DIRECTORY];
  while (queue.length > 0) {
    const directory = queue.shift() ?? "";
    const entries = await readdir(join(root, directory), {
      withFileTypes: true,
    }).catch(() => []);
    for (const entry of entries) {
      if (DENIED_SEGMENTS.includes(entry.name)) continue;
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        queue.push(child);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (isSkillPath(child)) found.push(child);
    }
  }
  return found.sort((left, right) => left.localeCompare(right));
}

export class Injection {
  private cache: { expires: number; value: InjectionState } | null = null;

  constructor(
    private readonly root: string,
    private readonly header: () => string,
  ) {}

  async read(): Promise<InjectionState> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.value;
    const value = await this.build();
    this.cache = { expires: Date.now() + 1000, value };
    return value;
  }

  invalidate(): void {
    this.cache = null;
  }

  private async build(): Promise<InjectionState> {
    const skills: InjectionFile[] = [];
    const lines: string[] = [];
    for (const path of await discoverSkillPaths(this.root)) {
      const result = await readVault(this.root, path, INJECTION_BYTES_LIMIT);
      if (result.status !== "ok") continue;
      const meta = frontMatter(result.text);
      if (!meta.name || !meta.description) continue;
      skills.push({
        path,
        status: result.truncated ? "truncated" : "injected",
        bytes: result.bytes,
        modifiedAt: result.modifiedAt,
        name: meta.name,
        description: meta.description,
      });
      lines.push(`- ${meta.name}: ${meta.description} — read_vault "${path}"`);
    }
    const sections = [this.header()];
    if (lines.length > 0) sections.push(`Vault skills:\n${lines.join("\n")}`);
    return { skills, block: sections.join("\n\n") };
  }
}
