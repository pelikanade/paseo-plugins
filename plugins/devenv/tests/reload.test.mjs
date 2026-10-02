import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { artifacts, fixture, until } from "./harness.mjs";

const { api, server } = await artifacts();

async function setup(t, settings = {}) {
  const f = await fixture(t, api);
  const hooks = new Map();
  const handlers = new Map();
  const state = { agent: { cwd: f.root, archivedAt: null }, refreshes: 0 };
  const cleanup = server.default({
    registerSettings: () => ({
      read: async () => ({
        status: "ready",
        values: api.settingsSchema.parse({
          devenvBin: f.binary,
          paseoBin: f.binary,
          ...settings,
        }),
      }),
      subscribe: () => () => {},
    }),
    before: (name, callback) => {
      hooks.set(name, callback);
      return () => {};
    },
    on: (name, callback) => {
      hooks.set(name, callback);
      return () => {};
    },
    handle: (contract, callback) => {
      handlers.set(contract.name, (agentId) =>
        callback(contract.input.parse({ agentId }), {
          paseo: {
            agents: {
              ref: () => ({
                refresh: async () => {
                  state.refreshes++;
                  return state.agent ? { agent: state.agent } : null;
                },
              }),
            },
          },
        }).then((view) => contract.output.parse(view)),
      );
    },
  });
  t.after(cleanup);
  const read = (id = "agent") => handlers.get("devenv.status")(id);
  const allow = (id = "agent") => handlers.get("devenv.allow")(id);
  const open = (id = "agent") =>
    hooks.get("agent.session_open")(
      {
        request: {
          agentId: id,
          cwd: f.root,
          env: {},
          purpose: "interactive",
          reason: "refresh",
        },
      },
      { signal: new AbortController().signal },
    );
  const settled = () => until(async () => !(await read()).autoReload);
  return { ...f, hooks, handlers, state, read, allow, open, settled, cleanup };
}

test("trust prepares in the background and reloads the target exactly once using the daemon home", async (t) => {
  const f = await setup(t);
  const previousHome = process.env.PASEO_HOME;
  const previousHost = process.env.PASEO_HOST;
  process.env.PASEO_HOME = join(f.temporary, "daemon home");
  process.env.PASEO_HOST = "ws://another-daemon.invalid";
  t.after(() => {
    if (previousHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = previousHome;
    if (previousHost === undefined) delete process.env.PASEO_HOST;
    else process.env.PASEO_HOST = previousHost;
  });
  await f.control({ delayCommands: { "direnv-export": 200, reload: 100 } });
  assert.equal((await f.open()).env.PASEO_DEVENV_STATUS, "denied");
  assert.equal((await f.read()).autoReload, false);
  assert.deepEqual(await f.calls(), []);
  const views = await Promise.all([f.allow(), f.allow()]);
  assert.ok(views.every((view) => view.autoReload && !view.applied));
  await until(async () =>
    (await f.calls()).some((call) => call.command === "reload"),
  );
  const pending = await f.read();
  assert.equal(pending.status, "ready");
  assert.equal(pending.autoReload, true);
  assert.equal(pending.applied, false);
  await f.settled();
  const calls = await f.calls();
  assert.deepEqual(
    calls.map((call) => call.command),
    ["allow", "direnv-export", "reload"],
  );
  assert.deepEqual(calls[2].args.slice(2), ["agent", "reload", "agent"]);
  assert.equal(calls[2].args[0], "--home");
  assert.equal(
    calls[2].args[1],
    process.env.PASEO_HOME || join(homedir(), ".paseo"),
  );
  assert.equal((await f.read()).needsReload, true);
  assert.equal((await f.open()).env.PROJECT_VERSION, "version-one");
  assert.equal((await f.read()).needsReload, false);
  await f.read();
  assert.equal((await f.calls()).length, 3);
});

test("trust and preparation failures do not reload and remain reviewable", async (t) => {
  for (const command of ["allow", "direnv-export"]) {
    await t.test(command, async (t) => {
      const f = await setup(t);
      await f.control({ failCommand: command });
      if (command === "allow")
        await assert.rejects(f.allow(), /intentional build failure/);
      else await f.allow();
      await f.settled();
      const view = await f.read();
      assert.equal(view.status, command === "allow" ? "denied" : "error");
      assert.match(view.error, /intentional build failure/);
      assert.ok((await f.calls()).every((call) => call.command !== "reload"));
    });
  }
});

test("a failed reload is reported and status polling never retries it", async (t) => {
  const f = await setup(t);
  await f.control({ failCommand: "reload" });
  await f.allow();
  await f.settled();
  const view = await f.read();
  assert.equal(view.status, "ready");
  assert.equal(view.needsReload, true);
  assert.match(
    view.error,
    /Automatic agent reload failed:.*intentional build failure/,
  );
  await f.read();
  assert.equal(
    (await f.calls()).filter((call) => call.command === "reload").length,
    1,
  );
  await f.control({});
  await f.allow();
  await f.settled();
  assert.equal((await f.read()).error, null);
});

test("revocation, project changes, missing agents and archiving cancel the automatic reload", async (t) => {
  for (const change of ["revoked", "changed", "missing", "archived", "moved"]) {
    await t.test(change, async (t) => {
      const f = await setup(t);
      await f.control({ delayCommands: { "direnv-export": 200 } });
      await f.allow();
      await until(async () =>
        (await f.calls()).some((call) => call.command === "direnv-export"),
      );
      const refreshes = f.state.refreshes;
      switch (change) {
        case "revoked":
          await f.trust([]);
          break;
        case "changed":
          await writeFile(join(f.root, "devenv.nix"), "version-two");
          break;
        case "missing":
          f.state.agent = null;
          break;
        case "archived":
          f.state.agent.archivedAt = "today";
          f.hooks.get("agent.archived")({ agent: { id: "agent" } });
          break;
        case "moved":
          f.state.agent.cwd = f.temporary;
          break;
      }
      if (change === "missing")
        await until(() => f.state.refreshes > refreshes);
      else await f.settled();
      await f.cleanup();
      assert.ok((await f.calls()).every((call) => call.command !== "reload"));
    });
  }
});

test("shutdown cancels an in-flight reload subprocess", async (t) => {
  const f = await setup(t);
  await f.control({ delayCommands: { reload: 10000 } });
  await f.allow();
  await until(async () =>
    (await f.calls()).some((call) => call.command === "reload"),
  );
  const pid = (await f.calls()).at(-1).pid;
  await f.cleanup();
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("an opening that already applied the prepared environment needs no automatic reload", async (t) => {
  const f = await setup(t);
  await f.control({ delayCommands: { "direnv-export": 200 } });
  await f.allow();
  const opened = await f.open();
  assert.equal(opened.env.PROJECT_VERSION, "version-one");
  await f.settled();
  assert.equal((await f.read()).needsReload, false);
  assert.ok((await f.calls()).every((call) => call.command !== "reload"));
});
