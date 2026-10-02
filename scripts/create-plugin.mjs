import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [id, ...extra] = process.argv.slice(2);

if (!id || extra.length || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(
    "Usage: pnpm plugin:new <id> (lowercase letters, numbers, hyphens)",
  );
  process.exit(1);
}

const directory = path.join(root, "plugins", id);
const result = spawnSync("paseo", ["plugin", "init", directory, "--id", id], {
  cwd: root,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const packagePath = path.join(directory, "package.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
packageJson.name = `@paseo-plugins/${id}`;
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const greetingPath = path.join(directory, "client", "greeting.tsx");
const greeting = await readFile(greetingPath, "utf8");
await writeFile(
  greetingPath,
  greeting
    .replace(
      'onPress={() => greeting.mutate({ name: "Paseo" })}',
      'onPress={() => { greeting.mutate({ name: "Paseo" }); }}',
    )
    .replace(
      'onPress={() => openExternal("https://paseo.sh")}',
      'onPress={() => { openExternal("https://paseo.sh").catch(console.error); }}',
    ),
);

const webPath = path.join(directory, "client", "web.ts");
const web = await readFile(webPath, "utf8");
await writeFile(webPath, web.replace(/^\/\/[^\n]*\n/gm, ""));

const formatting = spawnSync("prettier", ["--write", directory], {
  cwd: root,
  stdio: "inherit",
});
if (formatting.error) {
  console.error(formatting.error.message);
  process.exit(1);
}
if (formatting.status !== 0) process.exit(formatting.status ?? 1);

console.log(`\nCreated plugins/${id}. Next:\n  pnpm install\n  pnpm check`);
