import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { chromium } from "@playwright/test";

export const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(root, "package.json"));
const cliPackage = require.resolve("@getpaseo/cli/package.json");
const cliRequire = createRequire(cliPackage);
const { readDaemonInstance, stopDaemonInstance } = cliRequire(
  "@getpaseo/server/daemon-control",
);
const cliEntry = join(dirname(cliPackage), "dist/index.js");
const { WebSocket } = cliRequire("ws");

export async function until(read, accepts, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    last = await read();
    if (accepts(last)) return last;
    await delay(200);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out after ${timeout}ms; last observation: ${JSON.stringify(last)}`,
  );
}

async function stop(child) {
  if (child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  process.kill(-child.pid, "SIGTERM");
  await Promise.race([exited, delay(10000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, "SIGKILL");
    await exited;
  }
}

export async function command(binary, args, options = {}) {
  const child = spawn(binary, args, {
    ...options,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const timer = setTimeout(() => {
    stop(child).catch(console.error);
  }, options.timeout ?? 120000);
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, `${binary} ${args.join(" ")}\n${stdout}\n${stderr}`);
    return stdout;
  } finally {
    clearTimeout(timer);
    await stop(child);
  }
}

export async function runtime(t, options = {}) {
  assert.equal(process.platform, "linux", "Session E2E requires Linux /proc");
  const temporary = await mkdtemp(join(tmpdir(), "paseo-plugin-e2e-"));
  const home = join(temporary, "daemon");
  const trust = join(temporary, "trust");
  const artifacts = join(root, "test-results", temporary.split("/").at(-1));
  let child;
  let client;
  let browser;
  let context;
  let output = "";
  let failed = false;
  const browserLogs = [];
  t.after(async () => {
    if (failed || !t.passed) {
      await mkdir(artifacts, { recursive: true });
      await writeFile(join(artifacts, "daemon.log"), output);
      await writeFile(join(artifacts, "browser.log"), browserLogs.join("\n"));
      if (context) {
        for (const [index, page] of context.pages().entries())
          await page
            .screenshot({ path: join(artifacts, `page-${index}.png`) })
            .catch(console.error);
        await context.tracing
          .stop({ path: join(artifacts, "trace.zip") })
          .catch(console.error);
      }
      t.diagnostic(`Failure artifacts: ${artifacts}`);
    }
    try {
      await Promise.allSettled([browser?.close(), client?.close()]);
      await stopDaemonInstance(home, { timeoutMs: 10000 });
    } finally {
      try {
        if (child) await stop(child);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  });
  for (const directory of [
    home,
    trust,
    join(temporary, "codex"),
    join(temporary, "cache"),
    join(temporary, "data"),
    join(temporary, "config"),
  ])
    await mkdir(directory, { recursive: true });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.startsWith("PASEO_") && !key.startsWith("DEVENV_"),
    ),
  );
  Object.assign(env, {
    PASEO_HOME: home,
    DEVENV_HOME: trust,
    XDG_CACHE_HOME: join(temporary, "cache"),
    XDG_DATA_HOME: join(temporary, "data"),
    XDG_CONFIG_HOME: join(temporary, "config"),
    CODEX_HOME: join(temporary, "codex"),
    PATH: `${join(root, "node_modules/.bin")}:${process.env.PATH}`,
  });
  await command("devenv", ["--version"], { env });
  await command("opencode", ["--version"], { env });
  await writeFile(
    join(home, "config.json"),
    JSON.stringify({
      daemon: {
        listen: options.socket ? join(home, "daemon.sock") : "127.0.0.1:0",
        relay: { enabled: false },
      },
      features: { webUi: { enabled: true } },
      agents: { skills: { selection: { mode: "custom", skills: [] } } },
      pluginsEnabled: true,
    }),
  );
  const daemonTools = join(temporary, "daemon-tools");
  await mkdir(daemonTools);
  const linked = new Set(["paseo"]);
  for (const directory of env.PATH.split(":")) {
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await Promise.all(
      names.map(async (name) => {
        if (linked.has(name)) return;
        linked.add(name);
        await symlink(join(directory, name), join(daemonTools, name));
      }),
    );
  }
  const daemonEnv = { ...env, PATH: daemonTools };
  await assert.rejects(command("paseo", ["--version"], { env: daemonEnv }), {
    code: "ENOENT",
  });
  let url;
  const start = async () => {
    child = spawn(
      process.execPath,
      [cliEntry, "daemon", "run", "--home", home],
      {
        env: daemonEnv,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    const instance = await until(
      async () => {
        assert.equal(child.exitCode, null, output);
        return readDaemonInstance(home);
      },
      (value) => value?.listen,
      60000,
    );
    url = `http://${instance.listen}`;
    client = new DaemonClient({
      url: options.socket
        ? `ws+unix://${instance.listen.replace(/^unix:\/\//, "")}:/ws`
        : `${url.replace("http", "ws")}/ws`,
      clientId: randomUUID(),
      appVersion: "0.10.2",
      webSocketFactory: (address, configuration) =>
        new WebSocket(address, configuration?.protocols, {
          headers: configuration?.headers,
        }),
    });
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    return instance;
  };
  await start();
  const restart = async () => {
    const instance = await readDaemonInstance(home);
    const config = JSON.parse(
      await readFile(join(home, "config.json"), "utf8"),
    );
    config.daemon.listen = instance.listen;
    await writeFile(join(home, "config.json"), JSON.stringify(config));
    await client.close();
    await stopDaemonInstance(home, { timeoutMs: 10000 });
    await stop(child);
    await start();
  };
  const install = async (id, path = join(root, "plugins", id)) => {
    const plugin = await client.installDirectoryPlugin(path);
    assert.equal(plugin.status, "running", JSON.stringify(plugin));
    return plugin;
  };
  const rpc = (id, method, input) => client.invokePluginRpc(id, method, input);
  const status = (agent) =>
    rpc("devenv", "devenv.status", { agentId: agent.id });
  const createAgent = async (cwd, title = "E2E agent", explicit = {}) =>
    client.createAgent({
      config: { provider: "opencode", cwd, title },
      env: explicit,
    });
  const project = async (name, marker = "initial") => {
    const directory = join(temporary, name);
    await mkdir(directory, { recursive: true });
    for (const file of ["devenv.yaml", "devenv.lock"])
      await cp(join(root, file), join(directory, file));
    await writeFile(join(directory, "devenv.nix"), nix(marker));
    return directory;
  };
  const openBrowser = async () => {
    let executablePath = process.env.PASEO_E2E_BROWSER;
    if (!executablePath) {
      for (const directory of process.env.PATH.split(":")) {
        const binary = join(directory, "chromium");
        try {
          await access(binary);
          executablePath = binary;
          break;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    browser = await chromium.launch({ executablePath });
    context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    page.on("console", (message) => {
      browserLogs.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      browserLogs.push(error.stack);
    });
    return page;
  };
  return {
    temporary,
    home,
    trust,
    env,
    get url() {
      return url;
    },
    get client() {
      return client;
    },
    restart,
    install,
    rpc,
    status,
    createAgent,
    project,
    openBrowser,
    cli: (args) =>
      command(process.execPath, [cliEntry, "--home", home, ...args], { env }),
    test: async (name, body) => {
      let passed = false;
      await t.test(name, async (scenario) => {
        try {
          await body(scenario);
          passed = true;
        } catch (error) {
          failed = true;
          throw error;
        }
      });
      assert.equal(passed, true, `E2E scenario failed: ${name}`);
    },
  };
}

export function nix(marker) {
  return `{ pkgs, ... }: { packages = [ pkgs.nodejs_24 ]; env.PASEO_E2E_PROJECT = ${JSON.stringify(marker)}; env.E2E_PROJECT_VALUE = ${JSON.stringify(marker)}; }\n`;
}

export async function providerEnvironments(temporary) {
  const results = [];
  for (const pid of (await readdir("/proc")).filter((name) =>
    /^\d+$/.test(name),
  )) {
    try {
      const args = await readFile(`/proc/${pid}/cmdline`, "utf8");
      if (!args.includes("opencode") || !args.includes("serve")) continue;
      const environment = Object.fromEntries(
        (await readFile(`/proc/${pid}/environ`, "utf8"))
          .split("\0")
          .filter(Boolean)
          .map((entry) => {
            const index = entry.indexOf("=");
            return [entry.slice(0, index), entry.slice(index + 1)];
          }),
      );
      if (environment.XDG_DATA_HOME !== join(temporary, "data")) continue;
      results.push({
        pid,
        root: environment.PASEO_DEVENV_ROOT,
        status: environment.PASEO_DEVENV_STATUS,
        value: environment.E2E_PROJECT_VALUE,
        filtered: environment.PASEO_E2E_PROJECT,
      });
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return results;
}
