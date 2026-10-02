import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { artifacts, fixture, until } from "./harness.mjs";

const { api, server } = await artifacts();
test("nearest project, normalized trust paths and data-home precedence", async (t) => {
  const f = await fixture(t, api);
  const nested = join(f.root, "nested");
  await mkdir(nested);
  assert.equal(api.findRoot(nested), f.root);
  await writeFile(join(nested, "devenv.nix"), "inner");
  assert.equal(api.findRoot(nested), nested);
  const link = join(f.temporary, "link");
  await symlink(f.root, link);
  await f.trust(["# comment", join(link, "..", "link"), "/missing"]);
  assert.equal(api.isTrusted(f.root), true);
  assert.equal(api.isTrusted(nested), false);
  assert.equal(api.findRoot(link), f.root);
  const child = join(f.root, "child");
  await mkdir(child);
  const childLink = join(f.temporary, "child-link");
  await symlink(child, childLink);
  assert.equal(api.findRoot(childLink), f.root);
  assert.equal(
    api.trustPath({
      DEVENV_HOME: "/explicit",
      XDG_DATA_HOME: "/data",
      HOME: "/home",
    }),
    "/explicit/allowed",
  );
  assert.equal(
    api.trustPath({ XDG_DATA_HOME: "/data", HOME: "/home" }),
    "/data/devenv/allowed",
  );
  assert.equal(
    api.trustPath({ HOME: "/home" }),
    "/home/.local/share/devenv/allowed",
  );
  for (let i = 0; i < 4; i++)
    assert.equal(f.environments.view("agent", nested).status, "denied");
  assert.deepEqual(await f.calls(), []);
});
test("trust gate, shared build, delta filtering, caller overrides and actual subprocess environment", async (t) => {
  const f = await fixture(t, api, {}, 2000);
  const host = {
    CALLER: "kept",
    PROJECT_VERSION: "caller-wins",
    PASEO_DEVENV_STATUS: "forged",
  };
  const denied = await f.open("agent", host);
  assert.equal(denied.PASEO_DEVENV_STATUS, "denied");
  assert.equal(denied.DEVENV_ROOT, undefined);
  assert.deepEqual(await f.calls(), []);
  await f.environments.allow(f.root);
  await f.control({
    delayMs: 80,
    exports: {
      PASEO_FORGED: "bad",
      paseo_lower: "bad",
      TMPDIR: "/bad",
      TERM: "bad",
      NO_COLOR: "bad",
      CUSTOM: "first\nsecond=third",
      EMPTY: "",
      QUOTED: "it's $HOME `echo nope`",
    },
    script: "unset HOME\n",
  });
  const [one, two] = await Promise.all([
    f.open("agent", host),
    f.open("second"),
  ]);
  assert.equal(one.PROJECT_VERSION, "caller-wins");
  assert.equal(one.PASEO_DEVENV_STATUS, "ready");
  assert.equal(one.PASEO_DEVENV_ROOT, f.root);
  assert.equal(one.PASEO_FORGED, undefined);
  assert.equal(one.paseo_lower, undefined);
  assert.equal(one.TMPDIR, undefined);
  assert.equal(one.TERM, undefined);
  assert.equal(one.CUSTOM, "first\nsecond=third");
  assert.equal(one.QUOTED, "it's $HOME `echo nope`");
  assert.equal(one.EMPTY, "");
  assert.equal(one.HOME, undefined);
  assert.equal(two.PROJECT_VERSION, "version-one");
  const run = spawnSync("project-command", [], {
    env: { ...process.env, ...two },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "version-one");
  assert.equal(
    (await f.calls()).filter((call) => call.command === "direnv-export").length,
    1,
  );
  assert.deepEqual(f.environments.view("second", f.root), {
    root: f.root,
    status: "ready",
    applied: true,
    needsReload: false,
    error: null,
  });
  await f.open("third");
  assert.equal(
    (await f.calls()).filter((call) => call.command === "direnv-export").length,
    1,
  );
});
test("budget expiration and background success never mark the current agent as applied", async (t) => {
  const f = await fixture(t, api, {}, 20);
  await f.trust();
  await f.control({ delayMs: 100 });
  const started = Date.now();
  const first = await f.open("agent", { HOST_ONLY: "present" });
  assert.ok(Date.now() - started < 1000);
  assert.equal(first.PASEO_DEVENV_STATUS, "loading");
  assert.equal(first.PROJECT_VERSION, undefined);
  assert.equal(f.environments.view("agent", f.root).applied, false);
  await until(() => f.environments.view("agent", f.root).status === "ready");
  assert.equal(f.environments.view("agent", f.root).applied, false);
  assert.equal(f.environments.view("agent", f.root).needsReload, true);
  assert.equal((await f.open()).PROJECT_VERSION, "version-one");
  assert.equal(f.environments.view("agent", f.root).needsReload, false);
});
test(
  "the production hook budget is 25 seconds and preserves the background build",
  { timeout: 35000 },
  async (t) => {
    const f = await fixture(t, api);
    const environments = new api.Environments(
      api.settingsSchema.parse({ devenvBin: f.binary }),
    );
    t.after(() => environments.close());
    await f.trust();
    await f.control({ delayMs: 26000 });
    const start = Date.now();
    const host = await environments.open(
      "agent",
      f.root,
      {},
      new AbortController().signal,
    );
    assert.ok(Date.now() - start >= 24500);
    assert.ok(Date.now() - start < 29000);
    assert.equal(host.PROJECT_VERSION, undefined);
    assert.equal(host.PASEO_DEVENV_STATUS, "loading");
    await until(() => environments.view("agent", f.root).status === "ready");
    assert.equal(environments.view("agent", f.root).applied, false);
    assert.equal(environments.view("agent", f.root).needsReload, true);
  },
);
test("manual preparation, a removed project and canceled opening preserve session facts", async (t) => {
  const f = await fixture(t, api, {}, 1000);
  await f.trust();
  await f.open();
  await f.environments.load(f.root, true);
  assert.equal(f.environments.view("agent", f.root).applied, true);
  assert.equal(f.environments.view("agent", f.root).needsReload, true);
  await f.open();
  await unlink(join(f.root, "devenv.nix"));
  assert.deepEqual(f.environments.view("agent", f.root), {
    root: null,
    status: null,
    applied: true,
    needsReload: true,
    error: null,
  });
  const host = { HOST_ONLY: "present" };
  assert.equal(await f.open("none", host), host);
  const canceled = new AbortController();
  canceled.abort();
  assert.equal(
    await f.environments.open("canceled", f.root, host, canceled.signal),
    host,
  );
});
test("revocation prevents later injection and invalidates an in-flight result", async (t) => {
  const f = await fixture(t, api, {}, 1000);
  await f.trust();
  await f.open();
  await f.trust([]);
  assert.equal(f.environments.view("agent", f.root).needsReload, true);
  assert.equal(f.environments.view("agent", f.root).applied, true);
  assert.equal((await f.open()).PROJECT_VERSION, undefined);
  await f.trust();
  await f.control({ delayMs: 120 });
  const task = f.environments.load(f.root, true);
  await until(
    async () =>
      (await f.calls()).filter((call) => call.command === "direnv-export")
        .length === 2,
  );
  await f.trust([]);
  assert.equal(await task, undefined);
  await f.trust();
  assert.equal(f.environments.view("agent", f.root).status, "detected");
  assert.equal((await f.open()).PROJECT_VERSION, "version-one");
});
test("an older opening cannot claim application of a newer completed build", async (t) => {
  const f = await fixture(t, api, {}, 1000);
  await f.trust();
  await f.control({ delayMs: 10000, ignoreTerm: true });
  const opening = f.open();
  await until(async () => (await f.calls()).length === 1);
  f.environments.configure(
    api.settingsSchema.parse({
      devenvBin: f.binary,
      runtimeDir: join(f.temporary, "new-runtime"),
    }),
  );
  await f.control({});
  await f.environments.load(f.root);
  assert.equal(f.environments.view("agent", f.root).status, "ready");
  const host = await opening;
  assert.equal(host.PROJECT_VERSION, undefined);
  assert.equal(host.PASEO_DEVENV_STATUS, "detected");
  assert.equal(f.environments.view("agent", f.root).applied, false);
  assert.equal(f.environments.view("agent", f.root).needsReload, true);
  assert.equal((await f.open()).PASEO_DEVENV_STATUS, "ready");
});
test("project changes, settings changes and stale asynchronous results require a fresh build", async (t) => {
  const f = await fixture(t, api, {}, 1000);
  await f.trust();
  await f.open();
  for (const file of api.projectFiles) {
    await writeFile(join(f.root, file), `changed-${file}`);
    assert.equal(f.environments.view("agent", f.root).status, "detected");
    assert.equal(f.environments.view("agent", f.root).needsReload, true);
    await f.open();
  }
  await f.control({ delayMs: 120 });
  const task = f.environments.load(f.root, true);
  await until(() => f.environments.view("agent", f.root).status === "loading");
  await writeFile(join(f.root, "devenv.nix"), "newest");
  assert.equal(await task, undefined);
  assert.equal(f.environments.view("agent", f.root).status, "detected");
  const changed = api.settingsSchema.parse({
    devenvBin: f.binary,
    runtimeDir: join(f.temporary, "runtime"),
  });
  f.environments.configure(changed);
  await f.control({});
  assert.equal((await f.open()).PROJECT_VERSION, "newest");
  assert.equal((await f.calls()).at(-1).runtime, changed.runtimeDir);
  f.environments.configure({ ...changed, maxRoots: 3 });
  assert.equal(f.environments.view("agent", f.root).applied, true);
  assert.equal(f.environments.view("agent", f.root).needsReload, true);
});
test("failure cooldown, explicit retry, timeout, capture limit and teardown kill processes", async (t) => {
  const f = await fixture(
    t,
    api,
    { loadTimeoutMs: 150, failureRetryMs: 100 },
    1000,
  );
  await f.trust();
  await f.control({ fail: true });
  assert.equal((await f.open()).PASEO_DEVENV_STATUS, "error");
  await f.open();
  assert.equal((await f.calls()).length, 1);
  await delay(110);
  await f.control({});
  assert.equal((await f.open()).PROJECT_VERSION, "version-one");
  await f.control({ delayMs: 10000, ignoreTerm: true });
  assert.equal(await f.environments.load(f.root, true), undefined);
  assert.match(
    f.environments.view("agent", f.root).error,
    /canceled|timed out/,
  );
  const killed = (await f.calls()).at(-1).pid;
  assert.throws(() => process.kill(killed, 0), { code: "ESRCH" });
  f.environments.configure(
    api.settingsSchema.parse({ devenvBin: f.binary, maxCaptureBytes: 128 }),
  );
  await f.control({});
  await f.environments.load(f.root);
  assert.match(f.environments.view("agent", f.root).error, /maxCaptureBytes/);
  f.environments.configure(api.settingsSchema.parse({ devenvBin: f.binary }));
  await f.control({ delayMs: 10000 });
  const running = f.environments.load(f.root);
  const count = (await f.calls()).length;
  await until(async () => (await f.calls()).length > count);
  const pid = (await f.calls()).at(-1).pid;
  await f.environments.close();
  assert.equal(await running, undefined);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
test("cache capacity waits for active roots and evicts only finished entries", async (t) => {
  const f = await fixture(t, api, { maxRoots: 1 }, 1000);
  const other = join(f.temporary, "other");
  await mkdir(other);
  await writeFile(join(other, "devenv.nix"), "second");
  await f.trust([f.root, other]);
  await f.control({ delayMs: 70 });
  const first = f.environments.load(f.root);
  const second = f.environments.load(other);
  await Promise.all([first, second]);
  assert.equal((await f.calls()).length, 2);
  assert.equal(f.environments.view("agent", f.root).status, "detected");
  await f.environments.load(f.root);
  assert.equal((await f.calls()).length, 3);
});
test("compiled hooks preserve creation configuration, skip history, validate RPCs and clean up", async (t) => {
  const f = await fixture(t, api, {}, 1000);
  const hooks = new Map();
  const handlers = new Map();
  let disposed = 0;
  const cleanup = server.default({
    registerSettings: () => ({
      read: async () => ({
        status: "ready",
        values: api.settingsSchema.parse({ devenvBin: f.binary }),
      }),
      subscribe: () => () => {
        disposed++;
      },
    }),
    before: (name, callback) => {
      hooks.set(name, callback);
      return () => {
        disposed++;
      };
    },
    on: (name, callback) => {
      hooks.set(name, callback);
      return () => {
        disposed++;
      };
    },
    handle: (contract, callback) => {
      handlers.set(contract.name, (input) =>
        callback(contract.input.parse(input), {
          paseo: {
            agents: {
              ref: () => ({
                refresh: async () => ({ agent: { cwd: f.root } }),
              }),
            },
          },
        }).then((value) => contract.output.parse(value)),
      );
    },
  });
  t.after(cleanup);
  const config = {
    cwd: f.root,
    systemPrompt: "Existing instruction",
    mcpServers: {
      devenv: { type: "stdio", command: "existing", args: [] },
      other: { type: "stdio", command: "other", args: [] },
    },
  };
  const created = await hooks.get("agent.create")({ request: { config } });
  assert.ok(created.config.systemPrompt.startsWith("Existing instruction\n\n"));
  assert.match(created.config.systemPrompt, /PASEO_DEVENV_STATUS/);
  assert.deepEqual(created.config.mcpServers, config.mcpServers);
  const context = { signal: new AbortController().signal };
  const request = {
    agentId: "agent",
    cwd: f.root,
    env: {},
    purpose: "history",
  };
  assert.equal(
    await hooks.get("agent.session_open")({ request }, context),
    request,
  );
  assert.equal(
    (await handlers.get("devenv.status")({ agentId: "agent" })).status,
    "denied",
  );
  assert.deepEqual(await f.calls(), []);
  await assert.rejects(async () =>
    handlers.get("devenv.status")({ agentId: "" }),
  );
  await handlers.get("devenv.allow")({ agentId: "agent" });
  await until(
    async () =>
      (await handlers.get("devenv.status")({ agentId: "agent" })).status ===
      "ready",
  );
  const opened = await hooks.get("agent.session_open")(
    { request: { ...request, purpose: "resume" } },
    context,
  );
  assert.equal(opened.env.PROJECT_VERSION, "version-one");
  assert.equal(
    (await handlers.get("devenv.status")({ agentId: "agent" })).applied,
    true,
  );
  await cleanup();
  assert.equal(disposed, 4);
});
test("compiled MCP launcher uses the canonical cwd, checks trust and exchanges stdio JSON-RPC", async (t) => {
  const f = await fixture(t, api);
  const config = api.mcpConfig(f.root, f.binary);
  const denied = spawnSync(config.command, config.args, {
    env: process.env,
    encoding: "utf8",
  });
  assert.notEqual(denied.status, 0);
  assert.deepEqual(await f.calls(), []);
  await f.trust();
  const child = spawn(config.command, config.args, {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGTERM");
  });
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }) + "\n",
  );
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    }) + "\n",
  );
  await until(() => output.trim().split("\n").length >= 2);
  assert.equal(errors, "");
  const messages = output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(messages[1].result.tools[0].description, f.root);
  child.stdin.end();
  await new Promise((resolve, reject) => {
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(errors)),
    );
  });
  assert.equal((await f.calls()).at(-1).root, f.root);
});
