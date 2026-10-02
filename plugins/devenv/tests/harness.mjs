import { createRequire } from "node:module";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export const plugin = fileURLToPath(new URL("..", import.meta.url));
export const require = createRequire(join(plugin, "package.json"));
const rootRequire = createRequire(
  new URL("../../../package.json", import.meta.url),
);
const cliRequire = createRequire(
  rootRequire.resolve("@getpaseo/cli/package.json"),
);
const compilerPath = join(
  dirname(cliRequire.resolve("@getpaseo/server")),
  "plugins/compiler.js",
);
export const { compilePlugin } = await import(pathToFileURL(compilerPath));
export function evaluate(bundle, modules = require) {
  return Function(`return ${bundle}`)()(modules);
}
let compiled;
export function artifacts() {
  compiled ??= (async () => {
    const shipped = await compilePlugin({
      client: join(plugin, "index.client.tsx"),
      server: join(plugin, "index.server.ts"),
    });
    const temporary = await mkdtemp(join(tmpdir(), "paseo-devenv-compiler-"));
    try {
      for (const file of [
        "server",
        "shared",
        "package.json",
        "tsconfig.json",
        "index.server.ts",
      ])
        await cp(join(plugin, file), join(temporary, file), {
          recursive: true,
        });
      await symlink(
        join(plugin, "node_modules"),
        join(temporary, "node_modules"),
      );
      const entry = await readFile(join(temporary, "index.server.ts"), "utf8");
      await writeFile(
        join(temporary, "index.server.ts"),
        `${entry}\nimport { parseCapture } from "./server/environment";\nimport * as policy from "./server/policy";\nimport * as project from "./server/project";\nimport * as mcp from "./server/mcp";\nimport * as contracts from "./shared/contracts";\nexport function testApi() { return { Environments, parseCapture, ...policy, ...project, ...mcp, ...contracts }; }\n`,
      );
      const instrumented = await compilePlugin({
        client: null,
        server: join(temporary, "index.server.ts"),
      });
      return {
        ...shipped,
        api: evaluate(instrumented.serverBundle).testApi(),
        server: evaluate(shipped.serverBundle),
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  })();
  return compiled;
}
export async function until(predicate, timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error("Condition did not become true before deadline");
    await delay(10);
  }
}
export async function fixture(t, api, settings = {}, waitMs = 100) {
  const temporary = await mkdtemp(join(tmpdir(), "paseo-devenv-test-"));
  const root = join(temporary, "project with spaces");
  const home = join(temporary, "trust");
  await mkdir(root);
  await mkdir(home);
  await writeFile(join(root, "devenv.nix"), "version-one");
  const binary = join(temporary, "fake-devenv");
  const source = await readFile(
    new URL("fake-devenv.cjs", import.meta.url),
    "utf8",
  );
  await writeFile(
    binary,
    `#!${process.execPath}\n${source.replace('"__DIRECTORY__"', JSON.stringify(temporary))}`,
    { mode: 0o755 },
  );
  const previous = process.env.DEVENV_HOME;
  process.env.DEVENV_HOME = home;
  const environments = new api.Environments(
    api.settingsSchema.parse({ ...settings, devenvBin: binary }),
    waitMs,
  );
  t.after(async () => {
    await environments.close();
    if (previous === undefined) delete process.env.DEVENV_HOME;
    else process.env.DEVENV_HOME = previous;
    await rm(temporary, { recursive: true, force: true });
  });
  const control = async (values) => {
    await writeFile(join(temporary, "control.json"), JSON.stringify(values));
  };
  await control({});
  const trust = async (roots = [root]) => {
    await writeFile(join(home, "allowed"), roots.join("\n") + "\n");
  };
  const calls = async () => {
    try {
      return (await readFile(join(temporary, "calls.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  };
  const open = (id = "agent", env = {}) =>
    environments.open(id, root, env, new AbortController().signal);
  return {
    temporary,
    root,
    home,
    binary,
    environments,
    control,
    trust,
    calls,
    open,
  };
}
