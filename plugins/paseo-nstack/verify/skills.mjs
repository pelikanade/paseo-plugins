import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";

const root = fileURLToPath(new URL("../skills/nstack/", import.meta.url));
const target = fileURLToPath(
  new URL("../server/skills.generated.ts", import.meta.url),
);

async function paths(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await paths(path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
  }
  return found;
}

const entries = await Promise.all(
  (await paths(root))
    .sort()
    .map(async (path) => [
      relative(root, path).replaceAll("\\", "/"),
      await readFile(path, "utf8"),
    ]),
);
const compiled = await prettier.format(
  `export const skillFiles: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries(entries))};\n`,
  { ...(await prettier.resolveConfig(target)), filepath: target },
);

if (process.argv.includes("--write")) {
  await writeFile(target, compiled);
  console.log(
    `Generated server/skills.generated.ts from ${entries.length} files`,
  );
} else {
  if ((await readFile(target, "utf8")) !== compiled)
    throw new Error(
      `Bundled skills are stale: run node ${fileURLToPath(import.meta.url)} --write`,
    );
  console.log(`Bundled skills match ${entries.length} vendored files`);
}
