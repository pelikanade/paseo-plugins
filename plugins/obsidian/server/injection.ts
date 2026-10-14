import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { InjectionFile } from "../shared/contracts";
import { readVault } from "./vault";

export const INJECTION_BYTES_LIMIT = 32 * 1024;
export const SYSTEM_FILE = ".paseo/system.md";
export const SKILLS_DIRECTORY = ".paseo/skills";

export const INJECTION_INSTRUCTIONS =
  "The Obsidian vault reached through the obsidian MCP server is read-only: list_vault, glob_vault, grep_vault and read_vault. Use read_vault to open a note before relying on it, and prefer grep_vault to find the right note. Every result carries lastSyncedAt and stale; when stale is true the local copy may be behind the remote. Paths are vault-relative, and .obsidian and the trash folders are not readable.";

export interface InjectionState {
  systemPrompt: InjectionFile;
  skills: InjectionFile[];
  block: string;
}

interface InjectionFileText extends InjectionFile {
  text: string | null;
}

function frontMatter(text: string): {
  name?: string;
  description?: string;
} {
  if (!text.startsWith("---")) return {};
  const end = text.indexOf("\n---", 3);
  if (end < 0) return {};
  const fields: Record<string, string> = {};
  for (const line of text.slice(3, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (value) fields[line.slice(0, separator).trim()] = value;
  }
  return { name: fields.name, description: fields.description };
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

  private async file(relative: string): Promise<InjectionFileText> {
    const result = await readVault(this.root, relative, INJECTION_BYTES_LIMIT);
    if (result.status !== "ok")
      return {
        path: relative,
        status: "not_injected",
        bytes: null,
        modifiedAt: null,
        name: null,
        description: null,
        text: null,
      };
    return {
      path: relative,
      status: result.truncated ? "truncated" : "injected",
      bytes: result.bytes,
      modifiedAt: result.modifiedAt,
      name: null,
      description: null,
      text: result.text,
    };
  }

  private async build(): Promise<InjectionState> {
    const system = await this.file(SYSTEM_FILE);
    const names = (
      await readdir(join(this.root, SKILLS_DIRECTORY)).catch(() => [])
    )
      .filter((name) => name.endsWith(".md"))
      .sort((left, right) => left.localeCompare(right));
    const skills: InjectionFileText[] = [];
    const lines: string[] = [];
    for (const name of names) {
      const file = await this.file(`${SKILLS_DIRECTORY}/${name}`);
      const meta = frontMatter(file.text ?? "");
      const entry: InjectionFileText = {
        ...file,
        name: meta.name ?? null,
        description: meta.description ?? null,
        status: meta.name && meta.description ? file.status : "not_injected",
      };
      skills.push(entry);
      if (meta.name && meta.description)
        lines.push(
          `- ${meta.name}: ${meta.description} — read_vault "${entry.path}"`,
        );
    }
    const sections = [this.header()];
    if (system.text !== null) sections.push(system.text);
    if (lines.length > 0) sections.push(`Vault skills:\n${lines.join("\n")}`);
    const strip = (file: InjectionFileText): InjectionFile => ({
      path: file.path,
      status: file.status,
      bytes: file.bytes,
      modifiedAt: file.modifiedAt,
      name: file.name,
      description: file.description,
    });
    return {
      systemPrompt: strip(system),
      skills: skills.map(strip),
      block: sections.join("\n\n"),
    };
  }
}
