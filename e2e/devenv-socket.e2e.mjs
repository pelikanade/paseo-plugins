import assert from "node:assert/strict";
import test from "node:test";
import { runtime, until, providerEnvironments } from "./support/runtime.mjs";

test(
  "devenv reload uses the selected local socket daemon",
  { timeout: 300000 },
  async (t) => {
    const f = await runtime(t, { socket: true });
    await f.install("devenv");
    const project = await f.project("socket project", "socket");
    const agent = await f.createAgent(project, "Socket E2E");
    assert.equal((await f.status(agent)).status, "denied");
    const settings = await f.rpc("devenv", "settings.devenv.read", {});
    const configured = await f.rpc("devenv", "settings.devenv.write", {
      revision: settings.revision,
      values: { ...settings.values, paseoBin: "paseo-missing-e2e" },
    });
    assert.equal(configured.status, "saved");
    await f.rpc("devenv", "devenv.allow", { agentId: agent.id });
    const failed = await until(
      () => f.status(agent),
      (view) => !view.autoReload && view.error !== null,
      180000,
    );
    assert.equal(failed.status, "ready");
    assert.equal(failed.applied, false);
    assert.equal(failed.needsReload, true);
    assert.match(failed.error, /Automatic agent reload failed:.*ENOENT/);
    const restored = await f.rpc("devenv", "settings.devenv.write", {
      revision: configured.revision,
      values: settings.values,
    });
    assert.equal(restored.status, "saved");
    await f.rpc("devenv", "devenv.allow", { agentId: agent.id });
    const applied = await until(
      () => f.status(agent),
      (view) => {
        assert.equal(view.error, null);
        return view.applied && !view.autoReload;
      },
      180000,
    );
    assert.equal(applied.needsReload, false);
    await until(
      () => providerEnvironments(f.temporary),
      (values) =>
        values.some(
          (value) =>
            value.root === project &&
            value.status === "ready" &&
            value.value === "socket",
        ),
    );
  },
);
