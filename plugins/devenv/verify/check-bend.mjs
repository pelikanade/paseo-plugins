import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";

const here = fileURLToPath(new URL(".", import.meta.url));
const bend = process.env.BEND_BIN ?? "bend";
function run(command, args) {
  const result = spawnSync(command, args, { cwd: here, encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(result.stderr || result.stdout);
  return result.stdout;
}
const version = run(bend, ["version"]).trim();
if (version !== "bend 2.0.32")
  throw new Error(`Expected bend 2.0.32, found ${version}`);
const claims = readFileSync(join(here, "LAWS.bend"), "utf8");
const inherited =
  claims.split("law budget_elapsed_runs_on_host:")[0].trimEnd() + "\n";
if (
  createHash("sha256").update(inherited).digest("hex") !==
  "918e90e052e16f0e61e3dc821ff5145dce978dbae165d453ce464958b84683ed"
)
  throw new Error("The 36 inherited laws must remain unchanged");
const laws = [...claims.matchAll(/^law\s+(\w+)/gm)].map((match) => match[1]);
const proofs = [
  ...readFileSync(join(here, "PROOF.bend"), "utf8").matchAll(
    /^def\s+Laws\.(\w+)\s*\(/gm,
  ),
].map((match) => match[1]);
if (
  !laws.length ||
  new Set(laws).size !== laws.length ||
  new Set(proofs).size !== proofs.length ||
  laws.length !== proofs.length ||
  laws.some((law) => !proofs.includes(law))
)
  throw new Error(
    "Every law must have exactly one proof; duplicate, missing or orphan proof detected",
  );
function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (
      entry.name.endsWith(".bend") &&
      /@unsafe|\?/.test(readFileSync(path, "utf8"))
    )
      throw new Error(`Proof escape or unfinished goal in ${path}`);
  }
}
scan(here);
const proof = run(bend, ["PROOF.bend"]);
if (!proof.includes("ALL PROOFS CHECK")) throw new Error(proof);
process.stdout.write(proof);
process.stdout.write(
  run(process.execPath, [join(here, "build-model.mjs"), "--check"]),
);
console.log(`Verified ${laws.length} laws with one proof each`);
