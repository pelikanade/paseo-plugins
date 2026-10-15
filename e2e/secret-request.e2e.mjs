import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { expect } from "@playwright/test";
import { root, runtime, until } from "./support/runtime.mjs";

const require = createRequire(
  join(root, "plugins/secret-request/package.json"),
);
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const TMPFS_MAGIC = 0x01021994;
const TTL_MS = 15 * 60 * 1000;
const SENTINEL = `paseo-e2e-secret-${randomUUID()}`;

async function treeContains(directory, needle) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await treeContains(path, needle);
      if (nested !== null) return nested;
      continue;
    }
    if (entry.isFile()) {
      let content;
      try {
        content = await readFile(path, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (content.includes(needle)) return path;
    }
  }
  return null;
}

async function pluginConnection(f, agentId) {
  return until(
    async () => {
      try {
        const state = JSON.parse(
          await readFile(
            join(f.home, "plugin-data", "secret-request", "state.json"),
            "utf8",
          ),
        );
        const session = state.sessions.find((item) => item.agentId === agentId);
        return state.port === 0 || session === undefined
          ? null
          : {
              url: `http://127.0.0.1:${String(state.port)}/mcp`,
              token: session.token,
            };
      } catch {
        return null;
      }
    },
    (value) => value !== null,
  );
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

test(
  "secret-request hands over one secret through a real daemon, MCP and Web UI",
  { timeout: 300000 },
  async (t) => {
    const f = await runtime(t);
    await f.install("secret-request");
    const agent = await f.createAgent(f.temporary, "Secret request E2E");
    let mcp;
    const connect = async () => {
      if (mcp) await mcp.close().catch(() => undefined);
      mcp = await until(
        async () => {
          let client;
          try {
            const connection = await pluginConnection(f, agent.id);
            client = new Client({
              name: "secret-request-e2e",
              version: "1.0.0",
            });
            await client.connect(
              new StreamableHTTPClientTransport(new URL(connection.url), {
                requestInit: {
                  headers: { Authorization: `Bearer ${connection.token}` },
                },
              }),
            );
            await client.listTools();
            await f.rpc("secret-request", "secret-request.status", {
              agentId: agent.id,
              requestId: "00000000-0000-0000-0000-000000000000",
            });
            return client;
          } catch {
            await client?.close().catch(() => undefined);
            return null;
          }
        },
        (value) => value !== null,
      );
    };
    await connect();
    t.after(() => mcp?.close());
    const items = async () => {
      const timeline = await f.client.fetchAgentTimeline(agent.id);
      return timeline.entries.filter(
        (entry) =>
          entry.item.type === "plugin" &&
          entry.item.pluginId === "secret-request",
      );
    };
    const request = async (label, hint) => {
      const pending = mcp.callTool({
        name: "request_secret",
        arguments: {
          label,
          description: "Provided for the end-to-end run.",
          hint: hint ?? "Paste the value and submit.",
        },
      });
      pending.catch(() => undefined);
      const item = await Promise.race([
        until(
          async () => (await items()).at(-1),
          (value) =>
            value !== undefined &&
            value.item.data.label === label &&
            value.item.data.status === "pending",
        ),
        pending.then((answer) => {
          throw new Error(
            `request_secret answered before any card appeared: ${JSON.stringify(answer)}`,
          );
        }),
      ]);
      return { pending, item };
    };
    const submit = (requestId, value) =>
      f.rpc("secret-request", "secret-request.submit", {
        agentId: agent.id,
        requestId,
        value,
      });
    let page;

    await f.test(
      "the real MCP transport blocks, then hands over a RAM-backed path",
      async () => {
        const tools = await mcp.listTools();
        assert.deepEqual(
          tools.tools.map((tool) => tool.name),
          ["request_secret"],
        );
        const { pending, item } = await request("Test password", "Any value.");
        const requestId = item.item.data.requestId;
        assert.equal(item.item.kind, "secret-request");
        assert.equal(item.item.version, 1);
        assert.equal(item.item.data.status, "pending");
        assert.equal(JSON.stringify(item.item.data).includes(SENTINEL), false);
        const result = await submit(requestId, SENTINEL);
        assert.equal(result.status, "delivered");
        assert.ok(result.path, JSON.stringify(result));
        const answered = await pending;
        assert.notEqual(answered.isError, true, JSON.stringify(answered));
        assert.deepEqual(JSON.parse(answered.content[0].text), result);
        assert.match(
          result.path,
          new RegExp(
            `^/dev/shm/paseo-${String(process.getuid())}-secret-request/`,
          ),
        );
        const stats = await stat(result.path);
        assert.equal(stats.mode & 0o777, 0o600);
        assert.equal(stats.uid, process.getuid());
        assert.equal(await readFile(result.path, "utf8"), SENTINEL);
        assert.equal((await statfs(dirname(result.path))).type, TMPFS_MAGIC);
        const delivered = await until(
          async () => (await items()).at(-1),
          (value) =>
            value !== undefined &&
            value.item.data.requestId === requestId &&
            value.item.data.status === "delivered",
        );
        assert.equal(delivered.item.data.status, "delivered");
        assert.equal(
          JSON.stringify(await f.client.fetchAgentTimeline(agent.id)).includes(
            SENTINEL,
          ),
          false,
        );
        assert.equal(f.daemonLog().includes(SENTINEL), false);
        assert.equal(
          JSON.stringify(
            await f.client.getPluginLogs("secret-request"),
          ).includes(SENTINEL),
          false,
        );
        assert.equal(await treeContains(f.home, SENTINEL), null);
        const again = await submit(requestId, SENTINEL);
        assert.deepEqual(again, result);
        assert.equal((await readdir(dirname(result.path))).length, 1);
        const status = await f.rpc("secret-request", "secret-request.status", {
          agentId: agent.id,
          requestId,
        });
        assert.equal(status.status, "delivered");
        const remaining = Date.parse(status.handoffExpiresAt) - Date.now();
        assert.ok(
          remaining > TTL_MS - 60000 && remaining <= TTL_MS,
          `handoff deadline ${String(status.handoffExpiresAt)}`,
        );
        assert.equal(await exists(result.path), true);
        const repeated = await request("Test password", "Second run.");
        assert.notEqual(
          repeated.item.item.data.requestId,
          requestId,
          "a request after a delivery must create a new card instead of joining a settled one",
        );
        const repeatedAgain = await submit(
          repeated.item.item.data.requestId,
          SENTINEL,
        );
        assert.equal(repeatedAgain.status, "delivered");
        assert.notEqual(repeatedAgain.path, result.path);
      },
    );

    await f.test(
      "a delivery survives the caller's timeout and a retry collects it",
      async () => {
        const label = `Timed out token ${randomUUID()}`;
        const timedOut = await mcp
          .callTool(
            {
              name: "request_secret",
              arguments: {
                label,
                description: "Provided for the end-to-end run.",
                hint: "Any value.",
              },
            },
            undefined,
            { timeout: 1500 },
          )
          .then(
            (answer) => {
              throw new Error(
                `a blocked call answered instead of timing out: ${JSON.stringify(answer)}`,
              );
            },
            (error) => error,
          );
        assert.equal(timedOut.code, -32001, String(timedOut));
        const card = await until(
          async () => (await items()).at(-1),
          (value) =>
            value !== undefined &&
            value.item.data.label === label &&
            value.item.data.status === "pending",
        );
        const requestId = card.item.data.requestId;
        const delivered = await submit(requestId, SENTINEL);
        assert.equal(delivered.status, "delivered");
        assert.ok(delivered.path, JSON.stringify(delivered));
        assert.equal(await readFile(delivered.path, "utf8"), SENTINEL);
        const unrelated = await request("Unrelated token", "Any value.");
        assert.notEqual(
          unrelated.item.item.data.requestId,
          requestId,
          "a request under a different label must not collect another request's delivery",
        );
        await f.rpc("secret-request", "secret-request.cancel", {
          agentId: agent.id,
          requestId: unrelated.item.item.data.requestId,
        });
        await unrelated.pending;
        const cards = (await items()).length;
        const collected = await mcp.callTool(
          {
            name: "request_secret",
            arguments: { label: `${label} (retry)` },
          },
          undefined,
          { timeout: 20000 },
        );
        assert.notEqual(collected.isError, true, JSON.stringify(collected));
        const recovered = JSON.parse(collected.content[0].text);
        assert.equal(recovered.requestId, requestId);
        assert.equal(recovered.path, delivered.path);
        assert.equal(recovered.label, label);
        assert.equal((await items()).length, cards);
        assert.deepEqual(
          await f.rpc("secret-request", "secret-request.status", {
            agentId: agent.id,
            requestId,
          }),
          {
            status: "delivered",
            handoffExpiresAt: delivered.handoffExpiresAt,
          },
        );
        const repeated = await request(label, "Any value.");
        assert.notEqual(
          repeated.item.item.data.requestId,
          requestId,
          "collecting a delivery must free its label for a new request",
        );
        await f.rpc("secret-request", "secret-request.cancel", {
          agentId: agent.id,
          requestId: repeated.item.item.data.requestId,
        });
        await repeated.pending;
      },
    );

    await f.test(
      "handoffs disappear on archive, reload and daemon restart",
      async () => {
        const reloaded = await request("Password for reload");
        const beforeReload = await submit(
          reloaded.item.item.data.requestId,
          SENTINEL,
        );
        assert.equal(beforeReload.status, "delivered");
        const reloadedAnswer = await reloaded.pending;
        assert.notEqual(
          reloadedAnswer.isError,
          true,
          JSON.stringify(reloadedAnswer),
        );
        await f.client.reloadPlugin("secret-request");
        await connect();
        await until(
          () => exists(beforeReload.path),
          (present) => present === false,
        );
        const forgotten = await f.rpc(
          "secret-request",
          "secret-request.status",
          { agentId: agent.id, requestId: reloaded.item.item.data.requestId },
        );
        assert.equal(forgotten.status, "gone");
        const restarted = await request("Password for restart");
        const beforeRestart = await submit(
          restarted.item.item.data.requestId,
          SENTINEL,
        );
        assert.equal(beforeRestart.status, "delivered");
        await f.restart();
        await connect();
        await until(
          () => exists(beforeRestart.path),
          (present) => present === false,
        );
        const archived = await request("Password for archive");
        await f.client.archiveAgent(agent.id);
        const gone = JSON.parse((await archived.pending).content[0].text);
        assert.equal(gone.status, "gone");
        assert.equal((await readdir(dirname(beforeRestart.path))).length, 0);
      },
    );
    await f.test(
      "the conversation card is the real input path and the value never renders",
      async () => {
        const { pending, item } = await request("Card password");
        const requestId = item.item.data.requestId;
        const { serverId } = JSON.parse(
          await readFile(join(f.home, "paseo.pid"), "utf8"),
        );
        assert.match(serverId, /^srv_/);
        page = await f.openBrowser();
        await page.goto(f.url);
        await page
          .locator('[data-testid^="sidebar-project-row-host:"]')
          .first()
          .waitFor({ state: "attached", timeout: 60000 });
        await page.goto(`${f.url}/h/${serverId}/agent/${agent.id}`);
        const card = page.getByTestId("secret-request-card").last();
        await card
          .waitFor({ state: "visible", timeout: 45000 })
          .catch((error) => {
            if (page.isClosed())
              throw new Error(
                "The Paseo Web UI closed the page when the conversation opened; this environment crashes that view for every workspace, with or without this plugin installed, so the card cannot be asserted here",
              );
            throw error;
          });
        const snapshot = await f.client.fetchAgent(agent.id);
        assert.equal((snapshot.agent.pendingPermissions ?? []).length, 0);
        await expect(card.getByTestId("secret-request-label")).toHaveText(
          "Card password",
        );
        await expect(card.getByTestId("secret-request-description")).toHaveText(
          "Provided for the end-to-end run.",
        );
        const input = card.getByTestId("secret-request-input");
        await expect(input).toHaveAttribute("type", "password");
        const submitButton = card.getByTestId("secret-request-submit");
        await expect(submitButton).toBeDisabled();
        await input.focus();
        await page.keyboard.type(SENTINEL);
        await input.evaluate((node, value) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          setter?.call(node, value);
          node.dispatchEvent(new Event("input", { bubbles: true }));
        }, SENTINEL);
        assert.equal(await input.inputValue(), SENTINEL);
        await expect(submitButton).toBeEnabled();
        await submitButton.click();
        await expect(
          card.getByTestId("secret-request-delivered"),
        ).toContainText(/./);
        const answered = await pending;
        const delivered = JSON.parse(answered.content[0].text);
        assert.equal(delivered.status, "delivered");
        assert.equal(delivered.requestId, requestId);
        assert.equal(await readFile(delivered.path, "utf8"), SENTINEL);
        await expect(page.getByText(SENTINEL)).toHaveCount(0);
        const rendered = await page
          .locator("input, textarea")
          .evaluateAll((elements) => elements.map((element) => element.value));
        assert.equal(
          rendered.some((value) => value.includes(SENTINEL)),
          false,
        );
        const declined = await request("Card password to decline");
        const declineCard = page.getByTestId("secret-request-card").last();
        await expect(
          declineCard.getByTestId("secret-request-label"),
        ).toHaveText("Card password to decline");
        await declineCard.getByTestId("secret-request-cancel").click();
        const canceled = JSON.parse((await declined.pending).content[0].text);
        assert.equal(canceled.status, "canceled");
        await until(
          async () => (await items()).at(-1),
          (value) =>
            value !== undefined &&
            value.item.data.requestId === declined.item.item.data.requestId &&
            value.item.data.status === "canceled",
        );
        await expect(
          declineCard.getByTestId("secret-request-headline"),
        ).toContainText(/./);
        await expect(
          declineCard.getByTestId("secret-request-input"),
        ).toHaveCount(0);
      },
    );

    await f.test(
      "a browser can deliver keyboard text to the card field",
      async () => {
        const { pending } = await request("Card password for typing");
        await expect(
          page.getByTestId("secret-request-card").last(),
        ).toBeAttached();
        const field = page
          .getByTestId("secret-request-card")
          .last()
          .getByTestId("secret-request-input");
        await field.click();
        await field.pressSequentially("typed-value", { delay: 20 });
        await page.waitForTimeout(500);
        const typed = await field.inputValue();
        if (typed !== "typed-value") {
          const control = await page.evaluate(() => {
            const probe = document.createElement("input");
            probe.id = "keyboard-control";
            probe.style.cssText =
              "position:fixed;top:0;left:0;width:200px;height:30px;z-index:2147483647";
            document.body.appendChild(probe);
            probe.focus();
            return document.activeElement?.id ?? null;
          });
          await page.keyboard.type("control");
          const controlValue = await page.evaluate(
            () => document.getElementById("keyboard-control")?.value ?? null,
          );
          throw new Error(
            `keyboard text never reached any field in this browser: the card field kept ${JSON.stringify(typed)} and a plain focused input focused as ${JSON.stringify(control)} kept ${JSON.stringify(controlValue)}`,
          );
        }
        await field.evaluate((node) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )?.set;
          setter?.call(node, "");
          node.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page
          .getByTestId("secret-request-card")
          .last()
          .getByTestId("secret-request-cancel")
          .click();
        await pending;
      },
    );
  },
);

test(
  "a host without a memory-backed /dev/shm refuses instead of writing to disk",
  { timeout: 180000 },
  async (t) => {
    const f = await runtime(t, {
      daemonCommand: [
        "unshare",
        "-rm",
        "--propagation",
        "private",
        "bash",
        "-c",
        'mount --bind /tmp /dev/shm && exec "$0" "$@"',
        process.execPath,
      ],
    });
    await f.install("secret-request");
    const agent = await f.createAgent(f.temporary, "No tmpfs E2E");
    const connection = await pluginConnection(f, agent.id);
    const mcp = new Client({
      name: "secret-request-namespace",
      version: "1.0.0",
    });
    t.after(() => mcp.close());
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(connection.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${connection.token}` },
        },
      }),
    );
    const refused = await mcp.callTool({
      name: "request_secret",
      arguments: { label: "Password on a host without tmpfs" },
    });
    assert.equal(refused.isError, true, JSON.stringify(refused));
    assert.match(refused.content[0].text, /not memory-backed/);
    const timeline = await f.client.fetchAgentTimeline(agent.id);
    assert.equal(
      timeline.entries.filter(
        (entry) =>
          entry.item.type === "plugin" &&
          entry.item.pluginId === "secret-request",
      ).length,
      0,
    );
  },
);

test(
  "an expired handoff left by an earlier lifetime is swept while a live one is kept",
  { timeout: 180000 },
  async (t) => {
    const f = await runtime(t);
    await f.install("secret-request");
    const base = `/dev/shm/paseo-${String(process.getuid())}-secret-request`;
    const aged = join(base, randomUUID());
    const fresh = join(base, randomUUID());
    const agedFile = join(aged, randomUUID());
    const freshFile = join(fresh, randomUUID());
    const deadline = new Date(Date.now() - TTL_MS - 60000);
    t.after(async () => {
      await rm(aged, { recursive: true, force: true });
      await rm(fresh, { recursive: true, force: true });
    });
    await mkdir(aged, { mode: 0o700 });
    await mkdir(fresh, { mode: 0o700 });
    await writeFile(agedFile, SENTINEL, { mode: 0o600 });
    await writeFile(freshFile, SENTINEL, { mode: 0o600 });
    await utimes(agedFile, deadline, deadline);
    await utimes(aged, deadline, deadline);
    await f.client.reloadPlugin("secret-request");
    await until(
      () => exists(agedFile),
      (present) => present === false,
      20000,
    );
    assert.equal(await exists(aged), false);
    assert.equal(await exists(freshFile), true);
    assert.equal(await exists(fresh), true);
  },
);

test(
  "a live instance keeps its handoff directory fresh and repairs one that disappears",
  { timeout: 300000 },
  async (t) => {
    const f = await runtime(t);
    await f.install("secret-request");
    const agent = await f.createAgent(f.temporary, "Handoff liveness E2E");
    const base = `/dev/shm/paseo-${String(process.getuid())}-secret-request`;
    const root = await until(
      async () => {
        try {
          const { handoffId } = JSON.parse(
            await readFile(
              join(f.home, "plugin-data", "secret-request", "state.json"),
              "utf8",
            ),
          );
          const directory = join(base, handoffId);
          await stat(directory);
          return directory;
        } catch {
          return null;
        }
      },
      (value) => value !== null,
    );
    const connection = await pluginConnection(f, agent.id);
    const mcp = new Client({
      name: "secret-request-liveness",
      version: "1.0.0",
    });
    t.after(() => mcp.close());
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(connection.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${connection.token}` },
        },
      }),
    );
    const items = async () =>
      (await f.client.fetchAgentTimeline(agent.id)).entries.filter(
        (entry) =>
          entry.item.type === "plugin" &&
          entry.item.pluginId === "secret-request",
      );
    const deliver = async (label) => {
      const pending = mcp.callTool({
        name: "request_secret",
        arguments: { label },
      });
      pending.catch(() => undefined);
      const item = await until(
        async () => (await items()).at(-1),
        (value) =>
          value !== undefined &&
          value.item.data.label === label &&
          value.item.data.status === "pending",
      );
      const result = await f.rpc("secret-request", "secret-request.submit", {
        agentId: agent.id,
        requestId: item.item.data.requestId,
        value: SENTINEL,
      });
      await pending;
      return result;
    };

    await f.test(
      "the minute tick keeps the live directory fresh while a second instance sweeps",
      async () => {
        const before = (await stat(root)).mtimeMs;
        await until(
          () => stat(root).then((stats) => stats.mtimeMs),
          (value) => value > before,
          90000,
        );
        const abandoned = join(base, randomUUID());
        const abandonedFile = join(abandoned, randomUUID());
        const deadline = new Date(Date.now() - TTL_MS - 60000);
        t.after(() => rm(abandoned, { recursive: true, force: true }));
        await mkdir(abandoned, { mode: 0o700 });
        await writeFile(abandonedFile, SENTINEL, { mode: 0o600 });
        await utimes(abandonedFile, deadline, deadline);
        await utimes(abandoned, deadline, deadline);
        const peer = await runtime(t);
        await peer.install("secret-request");
        await peer.client.reloadPlugin("secret-request");
        await until(
          () => exists(abandoned),
          (present) => present === false,
          45000,
        );
        assert.equal(await exists(root), true);
        const delivered = await deliver("Still live");
        assert.equal(delivered.status, "delivered");
        assert.equal(dirname(delivered.path), root);
        assert.equal(await readFile(delivered.path, "utf8"), SENTINEL);
      },
    );

    await f.test(
      "a delivery repairs the directory after it disappears",
      async () => {
        await rm(root, { recursive: true, force: true });
        const delivered = await deliver("After a loss");
        assert.equal(delivered.status, "delivered");
        assert.equal(dirname(delivered.path), root);
        const stats = await stat(root);
        assert.equal(stats.mode & 0o777, 0o700);
        assert.equal(stats.uid, process.getuid());
        assert.equal(await readFile(delivered.path, "utf8"), SENTINEL);
      },
    );
  },
);
