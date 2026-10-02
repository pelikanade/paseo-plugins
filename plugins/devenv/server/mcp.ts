import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { trustPath } from "./project";

type McpStdioServerConfig = Extract<
  NonNullable<
    PluginBeforeRequests["agent.create"]["config"]["mcpServers"]
  >[string],
  { type: "stdio" }
>;

export async function launchMcp(
  root: string,
  binary: string,
  allowedFile: string,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const canonical = await fs.realpath(root);
  const entries = (await fs.readFile(allowedFile, "utf8")).split("\n");
  let trusted = false;
  for (const line of entries) {
    const entry = line.trim();
    if (!entry || entry.startsWith("#")) continue;
    try {
      if ((await fs.realpath(entry)) === canonical) trusted = true;
    } catch {
      continue;
    }
  }
  if (!trusted)
    throw new Error(
      "devenv project is not trusted; allow it and reload the agent",
    );
  const child = spawn(binary, ["mcp"], { cwd: canonical, stdio: "inherit" });
  const term = () => {
    child.kill("SIGTERM");
  };
  const interrupt = () => {
    child.kill("SIGINT");
  };
  process.once("SIGTERM", term);
  process.once("SIGINT", interrupt);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    process.exitCode = typeof code === "number" ? code : 1;
  } finally {
    process.removeListener("SIGTERM", term);
    process.removeListener("SIGINT", interrupt);
  }
}
export function mcpConfig(root: string, binary: string): McpStdioServerConfig {
  const script = `(${launchMcp.toString()})(...JSON.parse(process.argv[1])).catch(error => { console.error(error.message); process.exitCode = 1; });`;
  return {
    type: "stdio",
    command: process.execPath,
    args: [
      "--input-type=module",
      "-e",
      script,
      JSON.stringify([root, binary, trustPath()]),
    ],
  };
}
