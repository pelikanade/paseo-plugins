import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const source = fileURLToPath(
  new URL("../skills/devenv/SKILL.md", import.meta.url),
);
const target = fileURLToPath(
  new URL("../server/skill.generated.ts", import.meta.url),
);
const skill = await readFile(source, "utf8");
const compiled = await prettier.format(
  `export const skill = ${JSON.stringify(skill)};\n`,
  { ...(await prettier.resolveConfig(target)), filepath: target },
);
if (process.argv.includes("--write")) {
  await writeFile(target, compiled);
  console.log("Generated server/skill.generated.ts");
} else {
  if ((await readFile(target, "utf8")) !== compiled)
    throw new Error(
      `Bundled skill is stale: run node ${fileURLToPath(import.meta.url)} --write`,
    );
  console.log("Bundled skill matches skills/devenv/SKILL.md");
}
