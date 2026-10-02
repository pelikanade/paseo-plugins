import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compilePlugin, plugin, require } from "./harness.mjs";

test("the standalone package contains its model, proofs and guidance and compiles without Bend or local dependencies", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "paseo-devenv-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--pack-destination", directory],
    {
      cwd: plugin,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: join(directory, "cache") },
    },
  );
  assert.equal(packed.status, 0, packed.stderr);
  const [info] = JSON.parse(packed.stdout);
  const paths = new Set(info.files.map((file) => file.path));
  for (const path of [
    "paseo-plugin.json",
    "index.server.ts",
    "index.client.tsx",
    "server/model.generated.mjs",
    "server/model.generated.d.mts",
    "shared/contracts.ts",
    "verify/model.bend",
    "verify/LAWS.bend",
    "verify/PROOF.bend",
    "verify/check-bend.mjs",
    "verify/build-model.mjs",
    "README.md",
    "PROVENANCE.md",
  ])
    assert.ok(paths.has(path), path);
  const unpacked = spawnSync(
    "tar",
    ["-xzf", join(directory, info.filename), "-C", directory],
    { encoding: "utf8" },
  );
  assert.equal(unpacked.status, 0, unpacked.stderr);
  const standalone = join(directory, "package");
  const { clientBundle, serverBundle } = await compilePlugin({
    client: join(standalone, "index.client.tsx"),
    server: join(standalone, "index.server.ts"),
  });
  assert.ok(clientBundle);
  assert.ok(serverBundle);
  assert.ok(!serverBundle.includes('model.generated.mjs"'));
  assert.ok(!clientBundle.includes("node:child_process"));
  const sdk = JSON.parse(
    await readFile(
      require
        .resolve("@getpaseo/plugin")
        .replace(/dist\/index\.js$/, "package.json"),
      "utf8",
    ),
  );
  assert.equal(sdk.version, "0.10.2");
});
