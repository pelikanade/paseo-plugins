import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { parseHostPort } from "@getpaseo/protocol/daemon-endpoints";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { z } from "zod";

export function daemonHome(): string {
  return process.env.PASEO_HOME || join(homedir(), ".paseo");
}

export async function reloadAgent(agentId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const home = daemonHome();
  const { listen } = z
    .object({ listen: z.string().min(1) })
    .parse(JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")));
  let url: string;
  let socketPath: string | undefined;
  if (listen.startsWith("/") || listen.startsWith("unix://")) {
    socketPath = listen.replace(/^unix:\/\//, "");
    url = `ws+unix://${socketPath}:/ws`;
  } else if (
    listen.startsWith("\\\\.\\pipe\\") ||
    listen.startsWith("pipe://")
  ) {
    socketPath = listen.replace(/^pipe:\/\//, "");
    url = "ws://localhost/ws";
  } else {
    const endpoint = parseHostPort(listen);
    const host =
      endpoint.host === "0.0.0.0"
        ? "127.0.0.1"
        : endpoint.host === "::"
          ? "::1"
          : endpoint.host;
    url = `ws://${endpoint.isIpv6 ? `[${host}]` : host}:${String(endpoint.port)}/ws`;
  }
  const client = new DaemonClient({
    url,
    clientId: randomUUID(),
    clientType: "cli",
    reconnect: { enabled: false },
    connectTimeoutMs: 15000,
    localCredential: async () =>
      (await readFile(join(home, "local-credential"), "utf8")).trim(),
    webSocketFactory: (address, options) => {
      const socket = new WebSocket(address, options?.protocols, {
        headers: options?.headers,
        ...(socketPath ? { socketPath } : {}),
      });
      return {
        get readyState() {
          return socket.readyState;
        },
        send: (data: string | Uint8Array | ArrayBuffer) => {
          socket.send(data);
        },
        close: (code?: number, reason?: string) => {
          socket.close(code, reason);
        },
        on: (event: string, listener: (...args: unknown[]) => void) => {
          socket.on(event, listener);
        },
        off: (event: string, listener: (...args: unknown[]) => void) => {
          socket.off(event, listener);
        },
      };
    },
  });
  let cancel: (() => void) | undefined;
  const canceled = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(new Error("Agent reload canceled or timed out"));
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
  });
  try {
    await Promise.race([
      (async () => {
        signal.throwIfAborted();
        await client.connect();
        signal.throwIfAborted();
        await client.fetchAgents({ subscribe: {} });
        signal.throwIfAborted();
        await client.refreshAgent(agentId);
      })(),
      canceled,
    ]);
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
    await client.close();
  }
}
