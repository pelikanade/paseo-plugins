import assert from "node:assert/strict";
import test from "node:test";
import { cp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { artifacts, fixture } from "./harness.mjs";

test(
  "optional real devenv capture injects a declarative environment into a subprocess",
  { skip: process.env.PASEO_DEVENV_REAL !== "1", timeout: 180000 },
  async (t) => {
    const { api } = await artifacts();
    const f = await fixture(t, api);
    for (const file of ["devenv.yaml", "devenv.lock"])
      await cp(
        new URL(`../../../${file}`, import.meta.url),
        join(f.root, file),
      );
    await writeFile(
      join(f.root, "devenv.nix"),
      '{ pkgs, ... }: { packages = [ pkgs.nodejs_24 ]; env.DEVENV_PASEO_TEST = "real-capture"; }\n',
    );
    const environments = new api.Environments(
      api.settingsSchema.parse({
        devenvBin: process.env.PASEO_REAL_DEVENV_BIN ?? "devenv",
      }),
    );
    const cache = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = join(f.temporary, "cache");
    t.after(async () => {
      await environments.close();
      if (cache === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = cache;
    });
    assert.equal(environments.view("agent", f.root).status, "denied");
    await environments.allow(f.root);
    const delta = await environments.load(f.root);
    assert.ok(delta, environments.view("agent", f.root).error);
    assert.equal(delta.DEVENV_PASEO_TEST, "real-capture");
    const injected = await environments.open(
      "agent",
      f.root,
      {},
      new AbortController().signal,
    );
    const child = spawnSync(
      "node",
      [
        "-p",
        "JSON.stringify([process.versions.node.split('.')[0], process.env.DEVENV_PASEO_TEST, process.env.PASEO_DEVENV_ROOT])",
      ],
      { env: { ...process.env, ...injected }, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), ["24", "real-capture", f.root]);
    assert.equal(environments.view("agent", f.root).applied, true);
  },
);
