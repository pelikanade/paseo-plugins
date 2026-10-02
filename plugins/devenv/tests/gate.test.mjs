import assert from "node:assert/strict";
import test from "node:test";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { plugin } from "./harness.mjs";

test("the verification gate refuses missing tools, wrong versions, escapes, open goals and incomplete coverage", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "paseo-devenv-gate-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await cp(join(plugin, "verify"), join(temporary, "verify"), {
    recursive: true,
  });
  await mkdir(join(temporary, "server"));
  await cp(
    join(plugin, "server/model.generated.mjs"),
    join(temporary, "server/model.generated.mjs"),
  );
  await symlink(join(plugin, "node_modules"), join(temporary, "node_modules"));
  const run = (extra) =>
    spawnSync(process.execPath, [join(temporary, "verify/check-bend.mjs")], {
      env: { ...process.env, ...extra },
      encoding: "utf8",
    });
  const missing = run({ BEND_BIN: join(temporary, "missing") });
  assert.notEqual(missing.status, 0);
  const wrong = join(temporary, "wrong-bend");
  await writeFile(
    wrong,
    `#!${process.execPath}\nconsole.log("bend 2.0.31");\n`,
    { mode: 0o755 },
  );
  assert.match(run({ BEND_BIN: wrong }).stderr, /Expected bend 2.0.32/);
  const original = await readFile(join(temporary, "verify/PROOF.bend"), "utf8");
  for (const escape of ["@unsafe", "def evil?", "?TODO", "?unfinished"]) {
    await writeFile(
      join(temporary, "verify/PROOF.bend"),
      original + "\n" + escape + "\n",
    );
    assert.match(run({}).stderr, /Proof escape or unfinished goal/);
  }
  await writeFile(
    join(temporary, "verify/PROOF.bend"),
    original.replace("def Laws.budget_elapsed_runs_on_host", "def Laws.orphan"),
  );
  assert.match(run({}).stderr, /Every law must have exactly one proof/);
  await writeFile(join(temporary, "verify/PROOF.bend"), original);
  await writeFile(
    join(temporary, "server/model.generated.mjs"),
    "export default {};\n",
  );
  assert.match(run({}).stderr, /Bend model artifact is stale/);
});
