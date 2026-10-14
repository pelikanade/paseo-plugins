import type { z } from "zod";
import type { searchItemSchema } from "../shared/contracts";
import { readVault, walkFiles } from "./vault";

const SEARCH_LIMIT = 50;
const SNAPSHOT_BYTES = 8 * 1024;
const TRUNCATION_MARKER = "\n[truncated]";

type SearchItem = z.infer<typeof searchItemSchema>;

function noteName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export async function searchVault(
  root: string,
  vaultName: string | null,
  query: string,
): Promise<SearchItem[]> {
  const walked = await walkFiles(root);
  const needle = query.trim().toLowerCase();
  const notes = walked.files
    .filter((file) => file.path.toLowerCase().endsWith(".md"))
    .filter(
      (file) =>
        !file.path.split("/").some((segment) => segment.startsWith(".")),
    )
    .filter((file) => {
      if (!needle) return true;
      return (
        file.path.toLowerCase().includes(needle) ||
        noteName(file.path).toLowerCase().includes(needle)
      );
    })
    .sort((left, right) =>
      noteName(left.path)
        .toLowerCase()
        .localeCompare(noteName(right.path).toLowerCase()),
    )
    .slice(0, SEARCH_LIMIT);
  const vault = vaultName ?? "vault";
  return Promise.all(
    notes.map(async (note) => {
      const result = await readVault(root, note.path, SNAPSHOT_BYTES);
      const header = `<${note.path}>`;
      const budget =
        SNAPSHOT_BYTES - header.length - 2 - TRUNCATION_MARKER.length;
      const body = result.status === "ok" ? result.text.slice(0, budget) : "";
      const truncated = result.status === "ok" && result.truncated;
      const folder = note.path.includes("/")
        ? note.path.slice(0, note.path.lastIndexOf("/"))
        : "Vault root";
      return {
        id: note.path,
        identifier: note.path,
        title: noteName(note.path).replace(/\.md$/i, ""),
        subtitle: folder,
        url: `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(note.path)}`,
        text: `${header}\n\n${body}${truncated ? TRUNCATION_MARKER : ""}`,
        resourceType: "obsidian-note" as const,
      };
    }),
  );
}
