import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import prettier from "prettier";

const here = fileURLToPath(new URL(".", import.meta.url));
const target = fileURLToPath(
  new URL("../server/model.generated.mjs", import.meta.url),
);
const scratch = await mkdtemp(join(tmpdir(), "paseo-devenv-model-"));
try {
  const fresh = join(scratch, "model.mjs");
  const result = spawnSync(
    process.env.BEND_BIN ?? "bend",
    ["model.bend", "-o", fresh],
    { cwd: here, encoding: "utf8" },
  );
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(result.stderr || result.stdout);
  const emitted = ts.transpileModule(await readFile(fresh, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
    },
  }).outputText;
  const compiled = await prettier.format(emitted, {
    ...(await prettier.resolveConfig(target)),
    filepath: target,
  });
  if (process.argv.includes("--check")) {
    if ((await readFile(target, "utf8")) !== compiled)
      throw new Error("Bend model artifact is stale; run pnpm build:model");
    console.log("Bend artifact matches a fresh compile");
  } else {
    await writeFile(target, compiled);
    console.log("Generated server/model.generated.mjs");
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
