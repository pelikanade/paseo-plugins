import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const files = [
  "SKILL.md",
  "references/protocol.md",
  "references/interactions.md",
  "assets/choice-form.json",
  "assets/comparison-table.json",
];
const root = new URL("../", import.meta.url);
const parts = await Promise.all(
  files.map(
    async (file) =>
      `${file}\n\n${await readFile(new URL(`skills/generative-ui/${file}`, root), "utf8")}`,
  ),
);
const source = await prettier.format(
  `export const guide = ${JSON.stringify(parts.join("\n\n"))};\n`,
  { parser: "typescript" },
);
const target = new URL("shared/guide.generated.ts", root);
if (process.argv.includes("--write")) await writeFile(target, source);
else if ((await readFile(target, "utf8")) !== source)
  throw new Error(
    `Bundled skill is stale: run node ${fileURLToPath(import.meta.url)} --write`,
  );
