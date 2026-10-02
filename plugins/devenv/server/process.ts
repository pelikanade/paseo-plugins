import { spawn } from "node:child_process";

export function run(
  argv: readonly [string, ...string[]],
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Process canceled"));
      return;
    }
    const [command, ...args] = argv;
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd,
      env,
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    let bytes = 0;
    let stderr = "";
    let failure: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const kill = (kind: NodeJS.Signals) => {
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch {
        child.kill(kind);
      }
    };
    const stop = () => {
      kill("SIGTERM");
      killTimer ??= setTimeout(() => {
        kill("SIGKILL");
      }, 1000);
    };
    const cancel = () => {
      failure = new Error("Process canceled or timed out");
      stop();
    };
    signal.addEventListener("abort", cancel, { once: true });
    const canceled = () => signal.aborted;
    if (canceled()) cancel();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        failure = new Error("Environment capture exceeds maxCaptureBytes");
        stop();
      } else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-65536);
    });
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code, termination) => {
      signal.removeEventListener("abort", cancel);
      if (killTimer !== null) clearTimeout(killTimer);
      if (failure !== null) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `${command} exited ${String(code ?? termination)}: ${stderr.trim().split("\n").slice(-3).join(" ")}`,
          ),
        );
      else resolve(Buffer.concat(output).toString());
    });
  });
}
