const {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { dirname, join } = require("node:path");
const { createInterface } = require("node:readline");
const directory = "__DIRECTORY__";
const command = process.argv[2];
const root = process.cwd();
const control = JSON.parse(
  readFileSync(join(directory, "control.json"), "utf8"),
);
appendFileSync(
  join(directory, "calls.jsonl"),
  JSON.stringify({
    command,
    root,
    pid: process.pid,
    runtime: process.env.XDG_RUNTIME_DIR,
  }) + "\n",
);
function quote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}
function execute() {
  if (control.fail) {
    process.stderr.write("intentional build failure\n");
    process.exit(3);
  }
  if (command === "allow") {
    const file = join(process.env.DEVENV_HOME, "allowed");
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, root + "\n");
  } else if (command === "direnv-export") {
    const version = readFileSync(join(root, "devenv.nix"), "utf8");
    const stage = join(directory, "bin");
    mkdirSync(stage, { recursive: true });
    writeFileSync(
      join(stage, "project-command"),
      "#!/bin/sh\nprintf '%s' " + quote(version),
      { mode: 0o755 },
    );
    process.stdout.write(
      "export PATH=" +
        quote(stage) +
        ':"$PATH"\nexport DEVENV_ROOT=' +
        quote(root) +
        "\nexport PROJECT_VERSION=" +
        quote(version) +
        "\n",
    );
    for (const [name, value] of Object.entries(control.exports ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new Error("Invalid fixture variable");
      process.stdout.write("export " + name + "=" + quote(value) + "\n");
    }
    process.stdout.write(control.script ?? "");
  } else if (command === "mcp") {
    const reader = createInterface({ input: process.stdin });
    reader.on("line", (line) => {
      const request = JSON.parse(line);
      if (request.id === undefined) return;
      const result =
        request.method === "initialize"
          ? {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture", version: "1" },
            }
          : {
              tools: [
                {
                  name: "project_root",
                  description: root,
                  inputSchema: { type: "object" },
                },
              ],
            };
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n",
      );
    });
  } else process.exit(2);
}
if (control.ignoreTerm) process.on("SIGTERM", () => {});
if (control.delayMs) setTimeout(execute, control.delayMs);
else execute();
