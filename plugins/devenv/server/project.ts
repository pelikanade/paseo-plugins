import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

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
    current = fs.realpathSync(path.resolve(cwd));
  } catch {
    return null;
  }
  for (;;) {
    if (fs.existsSync(path.join(current, "devenv.nix")))
      return fs.realpathSync(current);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
export function trustPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(
    env.DEVENV_HOME ||
      path.join(
        env.XDG_DATA_HOME ||
          path.join(env.HOME || homedir(), ".local", "share"),
        "devenv",
      ),
    "allowed",
  );
}
export function createTrustCheck(
  fs: typeof import("node:fs"),
  path: typeof import("node:path"),
) {
  const repository = (root: string) => {
    let current = root;
    for (;;) {
      const git = path.join(current, ".git");
      if (fs.existsSync(git)) {
        if (fs.statSync(git).isDirectory())
          return { root: current, git, directory: fs.realpathSync(git) };
        const pointer = fs.readFileSync(git, "utf8").trim();
        if (!pointer.startsWith("gitdir: ")) return null;
        return {
          root: current,
          git,
          directory: fs.realpathSync(path.resolve(current, pointer.slice(8))),
        };
      }
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  };
  const linkedProject = (canonical: string) => {
    const linked = repository(canonical);
    if (linked === null) return null;
    const common = fs.realpathSync(
      path.resolve(
        linked.directory,
        fs
          .readFileSync(path.join(linked.directory, "commondir"), "utf8")
          .trim(),
      ),
    );
    if (
      fs.realpathSync(path.dirname(linked.directory)) !==
        fs.realpathSync(path.join(common, "worktrees")) ||
      fs.realpathSync(
        path.resolve(
          linked.directory,
          fs.readFileSync(path.join(linked.directory, "gitdir"), "utf8").trim(),
        ),
      ) !== fs.realpathSync(linked.git)
    )
      return null;
    return { common, project: path.relative(linked.root, canonical) };
  };
  const trusted = (root: string, file: string): boolean => {
    try {
      const canonical = fs.realpathSync(root);
      const allowed = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line) => {
          const entry = line.trim();
          if (!entry || entry.startsWith("#")) return [];
          try {
            return [fs.realpathSync(entry)];
          } catch {
            return [];
          }
        });
      if (allowed.includes(canonical)) return true;
      const linked = linkedProject(canonical);
      if (linked === null) return false;
      return allowed.some((entry) => {
        try {
          const main = repository(entry);
          return (
            main !== null &&
            main.directory === linked.common &&
            path.relative(main.root, entry) === linked.project
          );
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  };
  return Object.assign(trusted, {
    mainProject(root: string): string | null {
      try {
        const linked = linkedProject(fs.realpathSync(root));
        if (linked === null) return null;
        const main = repository(path.dirname(linked.common));
        if (main === null || main.directory !== linked.common) return null;
        const project = fs.realpathSync(path.join(main.root, linked.project));
        if (
          !fs.existsSync(path.join(project, "devenv.nix")) ||
          repository(project)?.directory !== linked.common ||
          path.relative(main.root, project) !== linked.project
        )
          return null;
        return project;
      } catch {
        return null;
      }
    },
  });
}
const checkTrust = createTrustCheck(fs, path);
export function isTrusted(root: string, file = trustPath()): boolean {
  return checkTrust(root, file);
}
export function findMainProject(root: string): string | null {
  return checkTrust.mainProject(root);
}
export function signature(root: string): string {
  return projectFiles
    .map((file) => {
      try {
        const stat = fs.statSync(path.join(root, file), { bigint: true });
        return `${file}:${stat.mtimeNs.toString()}:${stat.ctimeNs.toString()}:${stat.size.toString()}`;
      } catch {
        return `${file}:-`;
      }
    })
    .join("|");
}
