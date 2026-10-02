import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { createTrustCheck, trustPath } from "./project";

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
  checkTrust: ReturnType<typeof createTrustCheck>,
): Promise<void> {
  const fs = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const canonical = await fs.realpath(root);
  if (!checkTrust(canonical, allowedFile))
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
  const script = `import * as fs from "node:fs"; import * as path from "node:path"; (${launchMcp.toString()})(...JSON.parse(process.argv[1]), (${createTrustCheck.toString()})(fs, path)).catch(error => { console.error(error.message); process.exitCode = 1; });`;
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
