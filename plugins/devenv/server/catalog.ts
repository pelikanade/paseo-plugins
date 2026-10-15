import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { Settings } from "../shared/contracts";
import { run } from "./process";

type McpChild = ChildProcessByStdio<Writable, Readable, Readable>;

const grouped = process.platform !== "win32";
const probeTimeoutMs = 20000;
const versionTimeoutMs = 10000;

function terminate(child: McpChild) {
  const pid = child.pid;
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (grouped && pid !== undefined) process.kill(-pid, signal);
      else child.kill(signal);
    } catch {
      child.kill(signal);
    }
  };
  kill("SIGTERM");
  setTimeout(() => {
    kill("SIGKILL");
  }, 1000);
}

function probe(
  binary: string,
  root: string,
  version: string,
  children: Set<McpChild>,
): Promise<string> {
  return new Promise<string>((resolve) => {
    const child = spawn(binary, ["mcp"], {
      cwd: root,
      detached: grouped,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    let done = false;
    let buffer = "";
    const finish = (catalog: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      children.delete(child);
      terminate(child);
      resolve(catalog);
    };
    const timer = setTimeout(() => {
      finish("");
    }, probeTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (typeof message !== "object" || message === null) continue;
        if (!("id" in message)) continue;
        if (message.id === 1) {
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
          );
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
          );
          continue;
        }
        if (message.id !== 2 || !("result" in message)) {
          finish("");
          continue;
        }
        const result = message.result;
        if (
          typeof result !== "object" ||
          result === null ||
          !("tools" in result)
        ) {
          finish("");
          continue;
        }
        finish(JSON.stringify({ version, tools: result.tools }));
      }
    });
    child.stderr.on("data", () => undefined);
    child.on("error", () => {
      finish("");
    });
    child.on("exit", () => {
      finish("");
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "paseo-devenv", version: "1" },
        },
      })}\n`,
    );
  });
}

export class McpCatalogs {
  private entries = new Map<string, Promise<string>>();
  private retries = new Map<string, number>();
  private children = new Set<McpChild>();
  private retryMs = 60000;

  configure(settings: Settings) {
    this.retryMs = settings.failureRetryMs;
  }

  read(binary: string, root: string): Promise<string> {
    const retryAt = this.retries.get(binary);
    if (retryAt !== undefined && Date.now() >= retryAt) {
      this.retries.delete(binary);
      this.entries.delete(binary);
    }
    const cached = this.entries.get(binary);
    if (cached !== undefined) return cached;
    const value = this.build(binary, root);
    this.entries.set(binary, value);
    return value;
  }

  close() {
    for (const child of this.children) terminate(child);
    this.children.clear();
    this.entries.clear();
    this.retries.clear();
  }

  private async build(binary: string, root: string): Promise<string> {
    const version = await run(
      [binary, "version"],
      root,
      process.env,
      AbortSignal.timeout(versionTimeoutMs),
      4096,
    )
      .then((output) => output.trim().split("\n")[0].slice(0, 64))
      .catch(() => "");
    const catalog = await probe(
      binary,
      root,
      version === "" ? binary : version,
      this.children,
    );
    if (catalog === "") this.retries.set(binary, Date.now() + this.retryMs);
    return catalog;
  }
}
