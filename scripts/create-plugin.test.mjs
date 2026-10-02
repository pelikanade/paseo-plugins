import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./create-plugin.mjs", import.meta.url));

test("invalid IDs and extra arguments are rejected before invoking Paseo", () => {
  for (const args of [
    [],
    ["../escape"],
    ["Uppercase"],
    ["bad/id"],
    ["ok", "extra"],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, PATH: "" },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: pnpm plugin:new/);
  }
});

test("existing plugin files are preserved when scaffold creation fails", async () => {
  const { readFile } = await import("node:fs/promises");
  const packagePath = fileURLToPath(
    new URL("../plugins/hello-paseo/package.json", import.meta.url),
  );
  const before = await readFile(packagePath, "utf8");
  const result = spawnSync(process.execPath, [script, "hello-paseo"], {
    cwd: path.dirname(script),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /directory must be empty/i);
  assert.equal(await readFile(packagePath, "utf8"), before);
});
