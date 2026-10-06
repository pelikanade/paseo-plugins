import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { command, root, runtime, until } from "./support/runtime.mjs";

const require = createRequire(join(root, "plugins/loop/package.json"));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

async function persistedAgent(home, id) {
  const directory = join(home, "agents");
  for (const entry of await readdir(directory)) {
    try {
      const record = JSON.parse(
        await readFile(join(directory, entry, `${id}.json`), "utf8"),
      );
      return typeof record === "object" && record !== null ? record : null;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function messages(client, agentId, needle) {
  const timeline = await client.fetchAgentTimeline(agentId);
  return timeline.entries.filter(
    (entry) =>
      entry.item.type === "user_message" && entry.item.text.includes(needle),
  );
}

function payload(text, sentinel) {
  const line = text.split("\n").find((item) => item.startsWith(sentinel));
  assert.ok(line, text);
  return JSON.parse(line.slice(sentinel.length).trim());
}

test(
  "loop schedules wakes on a real daemon and stops with the agent",
  { timeout: 300000 },
  async (t) => {
    const f = await runtime(t);
    await f.install("loop");
    const agent = await f.createAgent(f.temporary, "Loop E2E");
    const other = await f.createAgent(f.temporary, "Other loop agent");
    const connection = await f.rpc("loop", "loop.connection", {
      agentId: agent.id,
    });
    let mcp = new Client({ name: "loop-e2e", version: "1.0.0" });
    t.after(() => mcp.close());
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(connection.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${connection.token}` },
        },
      }),
    );
    const call = async (name, args) => {
      const response = await mcp.callTool({ name, arguments: args });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      return response.content[0].text;
    };

    await f.test(
      "parse accepts the loop forms and rejects a bare interval",
      async () => {
        assert.deepEqual(await f.rpc("loop", "loop.parse", { text: "" }), {
          type: "usage",
        });
        assert.deepEqual(await f.rpc("loop", "loop.parse", { text: "stop" }), {
          type: "stop",
        });
        assert.deepEqual(
          await f.rpc("loop", "loop.parse", { text: "5m check deploy" }),
          {
            type: "fixed",
            everySeconds: 300,
            prompt: "check deploy",
            purpose: "check-deploy",
          },
        );
        assert.deepEqual(
          await f.rpc("loop", "loop.parse", {
            text: "check deploy every 5 minutes",
          }),
          {
            type: "fixed",
            everySeconds: 300,
            prompt: "check deploy",
            purpose: "check-deploy",
          },
        );
        assert.deepEqual(
          await f.rpc("loop", "loop.parse", { text: "5m /foo" }),
          {
            type: "fixed",
            everySeconds: 300,
            prompt: "/foo",
            purpose: "foo",
          },
        );
        assert.deepEqual(
          await f.rpc("loop", "loop.parse", { text: "ping every 2h" }),
          {
            type: "fixed",
            everySeconds: 7200,
            prompt: "ping",
            purpose: "ping",
          },
        );
        assert.deepEqual(
          await f.rpc("loop", "loop.parse", { text: "work until tests pass" }),
          {
            type: "dynamic",
            prompt: "work until tests pass",
            purpose: "work-until-tests-pass",
          },
        );
        const bare = await f.rpc("loop", "loop.parse", { text: "5m" });
        assert.equal(bare.type, "invalid");
        const zero = await f.rpc("loop", "loop.parse", { text: "0s hello" });
        assert.equal(zero.type, "invalid");
        const huge = await f.rpc("loop", "loop.parse", { text: "8d hello" });
        assert.equal(huge.type, "invalid");
      },
    );

    await f.test(
      "a new agent receives the skill and the loop MCP server",
      async () => {
        const bundled = await readFile(
          join(root, "plugins/loop/skills/loop/SKILL.md"),
          "utf8",
        );
        const delivered = await until(
          () => persistedAgent(f.home, agent.id),
          (record) => record?.config?.systemPrompt?.includes(bundled) === true,
        );
        assert.match(delivered.config.systemPrompt, /Local loop scheduling/);
        assert.equal(delivered.config.mcpServers.loop.type, "http");
        assert.equal(
          delivered.config.mcpServers.loop.headers.Authorization,
          `Bearer ${connection.token}`,
        );
        const tools = await mcp.listTools();
        assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
          "get_loop_guide",
          "loop_arm",
          "loop_status",
          "loop_stop",
        ]);
        const guide = await call("get_loop_guide", {});
        assert.equal(guide, bundled);
        const resource = await mcp.readResource({
          uri: "skill://loop/SKILL.md",
        });
        assert.equal(resource.contents[0].text, bundled);
        const archive = join(f.temporary, "loop.tgz");
        await command(
          "pnpm",
          ["--filter", "@paseo-plugins/loop", "pack", "--out", archive],
          { cwd: root },
        );
        const files = await command("tar", ["-tf", archive]);
        for (const path of [
          "skills/loop/SKILL.md",
          "skills/loop/agents/openai.yaml",
          "server/skill.generated.ts",
          "index.client.tsx",
          "index.server.ts",
        ])
          assert.ok(files.includes(`package/${path}`), path);
        assert.equal(
          (await fetch(connection.url, { method: "POST", body: "{}" })).status,
          401,
        );
        assert.equal(
          (
            await fetch(connection.url, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${connection.token}`,
                Origin: "https://example.org",
              },
              body: "{}",
            })
          ).status,
          403,
        );
      },
    );

    await f.test(
      "a fixed loop does not wake before its first interval",
      async () => {
        const armed = JSON.parse(
          await call("loop_arm", {
            prompt: "check deploy",
            purpose: "deploy",
            mode: "fixed",
            everySeconds: 30,
          }),
        );
        assert.equal(armed.state, "armed");
        assert.equal(armed.mode, "fixed");
        assert.equal(armed.purpose, "deploy");
        assert.ok(Date.parse(armed.nextDueAt) - Date.now() > 20000);
        assert.equal(
          (await messages(f.client, agent.id, "AGENT_LOOP_TICK_")).length,
          0,
        );
        assert.equal(JSON.parse(await call("loop_stop", {})).state, "stopped");
        assert.equal(
          (await f.rpc("loop", "loop.status", { agentId: other.id })).state,
          "stopped",
        );
        await assert.rejects(
          f.rpc("loop", "loop.arm", {
            agentId: agent.id,
            prompt: "check deploy",
            mode: "dynamic",
            everySeconds: 30,
            heartbeatSeconds: 30,
          }),
          /Dynamic loops do not take everySeconds/,
        );
      },
    );

    await f.test(
      "a fixed tick delivers one wake and stop prevents the next",
      async () => {
        const ticking = await f.createAgent(f.temporary, "Tick E2E");
        await f.rpc("loop", "loop.arm", {
          agentId: ticking.id,
          prompt: "check deploy",
          purpose: "deploy",
          mode: "fixed",
          everySeconds: 3,
        });
        const found = await until(
          () => messages(f.client, ticking.id, "AGENT_LOOP_TICK_deploy"),
          (items) => items.length >= 1,
          20000,
        );
        assert.deepEqual(
          payload(found[0].item.text, "AGENT_LOOP_TICK_deploy"),
          {
            prompt: "check deploy",
            reason: "interval",
          },
        );
        assert.equal(
          (await messages(f.client, other.id, "AGENT_LOOP_TICK_")).length,
          0,
        );
        await f.rpc("loop", "loop.stop", { agentId: ticking.id });
        const count = (
          await messages(f.client, ticking.id, "AGENT_LOOP_TICK_deploy")
        ).length;
        await delay(1500);
        assert.equal(
          (await messages(f.client, ticking.id, "AGENT_LOOP_TICK_deploy"))
            .length,
          count,
        );
      },
    );

    await f.test(
      "a watcher wake is delivered and the process is killed on stop",
      async () => {
        const watching = await f.createAgent(f.temporary, "Watch E2E");
        const status = await f.rpc("loop", "loop.arm", {
          agentId: watching.id,
          prompt: "deploy finished",
          purpose: "deploy",
          mode: "dynamic",
          heartbeatSeconds: 60,
          watch: ["bash", "-c", "printf 'fired\\n'; sleep 30"],
        });
        assert.equal(status.state, "armed");
        assert.equal(typeof status.watchPid, "number");
        await access(`/proc/${status.watchPid}`);
        const found = await until(
          () => messages(f.client, watching.id, "AGENT_LOOP_WAKE_deploy"),
          (items) => items.length >= 1,
          20000,
        );
        assert.deepEqual(
          payload(found[0].item.text, "AGENT_LOOP_WAKE_deploy"),
          {
            prompt: "deploy finished",
            reason: "watch",
          },
        );
        assert.equal(
          (await f.rpc("loop", "loop.stop", { agentId: watching.id })).state,
          "stopped",
        );
        await until(
          async () => {
            try {
              await access(`/proc/${status.watchPid}`);
              return false;
            } catch (error) {
              return error.code === "ENOENT";
            }
          },
          (gone) => gone,
        );
        const count = (
          await messages(f.client, watching.id, "AGENT_LOOP_WAKE_deploy")
        ).length;
        await delay(500);
        assert.equal(
          (await messages(f.client, watching.id, "AGENT_LOOP_WAKE_deploy"))
            .length,
          count,
        );
      },
    );

    await f.test("an idle dynamic loop wakes from its heartbeat", async () => {
      const beating = await f.createAgent(f.temporary, "Heartbeat E2E");
      await f.rpc("loop", "loop.arm", {
        agentId: beating.id,
        prompt: "keep going",
        purpose: "keep",
        mode: "dynamic",
        heartbeatSeconds: 1,
      });
      const found = await until(
        () => messages(f.client, beating.id, "AGENT_LOOP_WAKE_keep"),
        (items) => items.length >= 1,
        20000,
      );
      assert.equal(
        payload(found[0].item.text, "AGENT_LOOP_WAKE_keep").reason,
        "heartbeat",
      );
      await f.rpc("loop", "loop.stop", { agentId: beating.id });
    });

    await f.test("replacing a loop kills the previous watcher", async () => {
      const replacing = await f.createAgent(f.temporary, "Replace E2E");
      const first = await f.rpc("loop", "loop.arm", {
        agentId: replacing.id,
        prompt: "first",
        purpose: "first",
        mode: "dynamic",
        heartbeatSeconds: 60,
        watch: ["bash", "-c", "sleep 30"],
      });
      await access(`/proc/${first.watchPid}`);
      const second = await f.rpc("loop", "loop.arm", {
        agentId: replacing.id,
        prompt: "second",
        purpose: "second",
        mode: "dynamic",
        heartbeatSeconds: 60,
        watch: ["bash", "-c", "sleep 30"],
      });
      assert.equal(second.purpose, "second");
      assert.notEqual(second.watchPid, first.watchPid);
      await until(
        async () => {
          try {
            await access(`/proc/${first.watchPid}`);
            return false;
          } catch (error) {
            return error.code === "ENOENT";
          }
        },
        (gone) => gone,
      );
      await access(`/proc/${second.watchPid}`);
      await f.rpc("loop", "loop.stop", { agentId: replacing.id });
    });

    await f.test(
      "reload clears the schedule and keeps the MCP address",
      async () => {
        await f.rpc("loop", "loop.arm", {
          agentId: agent.id,
          prompt: "after reload",
          purpose: "reload",
          mode: "fixed",
          everySeconds: 60,
        });
        await mcp.close();
        assert.equal((await f.client.reloadPlugin("loop")).status, "running");
        assert.equal(
          (await f.rpc("loop", "loop.status", { agentId: agent.id })).state,
          "stopped",
        );
        const reloaded = await f.rpc("loop", "loop.connection", {
          agentId: agent.id,
        });
        assert.deepEqual(reloaded, connection);
        mcp = new Client({ name: "loop-e2e-reloaded", version: "1.0.0" });
        await mcp.connect(
          new StreamableHTTPClientTransport(new URL(reloaded.url), {
            requestInit: {
              headers: { Authorization: `Bearer ${reloaded.token}` },
            },
          }),
        );
        assert.equal(
          JSON.parse(await call("loop_status", {})).state,
          "stopped",
        );
      },
    );

    await f.test("archiving the agent stops its loop", async () => {
      const archived = await f.createAgent(f.temporary, "Archive E2E");
      const armed = await f.rpc("loop", "loop.arm", {
        agentId: archived.id,
        prompt: "until archive",
        purpose: "archive",
        mode: "dynamic",
        heartbeatSeconds: 60,
        watch: ["bash", "-c", "sleep 30"],
      });
      await access(`/proc/${armed.watchPid}`);
      await f.client.archiveAgent(archived.id);
      assert.equal(
        (await f.rpc("loop", "loop.status", { agentId: archived.id })).state,
        "stopped",
      );
      await until(
        async () => {
          try {
            await access(`/proc/${armed.watchPid}`);
            return false;
          } catch (error) {
            return error.code === "ENOENT";
          }
        },
        (gone) => gone,
      );
    });
  },
);
