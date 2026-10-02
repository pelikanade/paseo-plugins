import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const projectFiles = [
  "devenv.nix",
  "devenv.yaml",
  "devenv.lock",
  "devenv.local.nix",
  "devenv.local.yaml",
];
export function findRoot(cwd: string): string | null {
  let current: string;
  try {
    current = realpathSync(resolve(cwd));
  } catch {
    return null;
  }
  for (;;) {
    if (existsSync(join(current, "devenv.nix"))) return realpathSync(current);
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
export function trustPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(
    env.DEVENV_HOME ||
      join(
        env.XDG_DATA_HOME || join(env.HOME || homedir(), ".local", "share"),
        "devenv",
      ),
    "allowed",
  );
}
export function isTrusted(root: string, file = trustPath()): boolean {
  try {
    const canonical = realpathSync(root);
    return readFileSync(file, "utf8")
      .split("\n")
      .some((line) => {
        const entry = line.trim();
        if (!entry || entry.startsWith("#")) return false;
        try {
          return realpathSync(entry) === canonical;
        } catch {
          return false;
        }
      });
  } catch {
    return false;
  }
}
export function signature(root: string): string {
  return projectFiles
    .map((file) => {
      try {
        const stat = statSync(join(root, file), { bigint: true });
        return `${file}:${stat.mtimeNs.toString()}:${stat.ctimeNs.toString()}:${stat.size.toString()}`;
      } catch {
        return `${file}:-`;
      }
    })
    .join("|");
}
