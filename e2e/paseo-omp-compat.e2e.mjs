import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { runtime, until } from "./support/runtime.mjs";
import { PASEO_FIRST_TEXT } from "../plugins/paseo-omp-compat/shared/paseo-first.ts";

const PLUGIN = "paseo-omp-compat";
const SENTINEL = "# Paseo first";
const FLAG = "--append-system-prompt";

async function processes() {
  const results = [];
  for (const pid of (await readdir("/proc")).filter((name) =>
    /^\d+$/.test(name),
  )) {
    try {
      const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
      const environment = Object.fromEntries(
        (await readFile(`/proc/${pid}/environ`, "utf8"))
          .split("\0")
          .filter(Boolean)
          .map((entry) => {
            const index = entry.indexOf("=");
            return [entry.slice(0, index), entry.slice(index + 1)];
          }),
      );
      results.push({ pid, argv, environment });
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return results;
}

async function launch(agent) {
  const found = await until(
    async () =>
      (await processes()).filter(
        (entry) =>
          entry.environment.PASEO_AGENT_ID === agent.id &&
          entry.argv.some((value) => value === "--mode"),
      ),
    (entries) => entries.length > 0,
    60000,
  );
  assert.equal(found.length, 1, `one omp process for ${agent.id}`);
  const { argv, environment } = found[0];
  const flags = argv.flatMap((value, index) =>
    value === FLAG ? [argv[index + 1]] : [],
  );
  return { argv, environment, flags };
}

function occurrences(text, needle) {
  return text.split("\n").filter((line) => line === needle).length;
}

test(
  "paseo-omp-compat appends the Paseo first directive to real omp sessions",
  { timeout: 600000 },
  async (t) => {
    const f = await runtime(t, {
      tools: ["omp"],
      isolateHome: true,
      env: { ANTHROPIC_API_KEY: "paseo-e2e-placeholder-never-used" },
      providers: { omp: { enabled: true } },
    });
    const project = join(f.temporary, "project");
    await mkdir(project, { recursive: true });
    const create = (title, systemPrompt) =>
      f.client.createAgent({
        config: {
          provider: "omp",
          cwd: project,
          title,
          ...(systemPrompt === undefined ? {} : { systemPrompt }),
        },
      });
    const status = (agent) =>
      f.rpc(PLUGIN, "paseo-omp-compat.status", { agentId: agent.id });
    const write = async (patch) => {
      const current = await f.rpc(PLUGIN, `settings.${PLUGIN}.read`, {});
      assert.equal(current.status, "ready", JSON.stringify(current));
      const saved = await f.rpc(PLUGIN, `settings.${PLUGIN}.write`, {
        revision: current.revision,
        values: { ...current.values, ...patch },
      });
      assert.equal(saved.status, "saved", JSON.stringify(saved));
    };

    await f.test("baseline: no directive without the plugin", async () => {
      const agent = await create("Baseline");
      const { flags } = await launch(agent);
      assert.deepEqual(
        flags.filter((value) => value.includes(SENTINEL)),
        [],
      );
      await f.client.archiveAgent(agent.id);
    });

    await f.test("install", async () => {
      const plugin = await f.install(PLUGIN);
      assert.equal(plugin.status, "running", JSON.stringify(plugin));
    });

    await f.test(
      "new agents receive the verbatim directive exactly once",
      async () => {
        const agent = await create("Enabled");
        const { flags, environment } = await launch(agent);
        assert.equal(flags.length, 1, JSON.stringify(flags));
        assert.equal(flags[0], PASEO_FIRST_TEXT);
        assert.equal(occurrences(flags[0], SENTINEL), 1);
        assert.equal(environment.PASEO_OMP_COMPAT_STATE, undefined);
        assert.deepEqual(await status(agent), {
          enabled: true,
          state: "builtin",
        });
        await f.client.archiveAgent(agent.id);
      },
    );

    await f.test("an existing system prompt is preserved", async () => {
      const agent = await create("Preserve", "Project rule: be brief.");
      const { flags } = await launch(agent);
      assert.equal(flags.length, 1);
      assert.equal(flags[0], `Project rule: be brief.\n\n${PASEO_FIRST_TEXT}`);
      assert.equal(occurrences(flags[0], SENTINEL), 1);
      await f.client.archiveAgent(agent.id);
    });

    await f.test(
      "a prompt that already carries the sentinel is not appended twice",
      async () => {
        const supplied = `${PASEO_FIRST_TEXT}\n\nExtra caller rule.`;
        const agent = await create("Idempotent", supplied);
        const { flags } = await launch(agent);
        assert.equal(flags.length, 1);
        assert.equal(flags[0], supplied);
        assert.equal(occurrences(flags[0], SENTINEL), 1);
        assert.deepEqual(await status(agent), {
          enabled: true,
          state: "present",
        });
        await f.client.archiveAgent(agent.id);
      },
    );

    await f.test("textOverride replaces the built-in text", async () => {
      await write({ textOverride: "# Paseo first\n\nOverride body." });
      const agent = await create("Override");
      const { flags } = await launch(agent);
      assert.equal(flags.length, 1);
      assert.equal(flags[0], "# Paseo first\n\nOverride body.");
      assert.deepEqual(await status(agent), {
        enabled: true,
        state: "override",
      });
      await f.client.archiveAgent(agent.id);
      await write({ textOverride: "" });
    });

    await f.test(
      "enabled: false removes the directive and is reported",
      async () => {
        await write({ enabled: false });
        const agent = await create("Disabled");
        const { flags, environment } = await launch(agent);
        assert.deepEqual(flags, []);
        assert.equal(environment.PASEO_OMP_COMPAT_STATE, undefined);
        assert.deepEqual(await status(agent), {
          enabled: false,
          state: "disabled",
        });
        const preserved = await create("Disabled keeps prompt", "Keep me.");
        const second = await launch(preserved);
        assert.deepEqual(second.flags, ["Keep me."]);
        await f.client.archiveAgent(agent.id);
        await f.client.archiveAgent(preserved.id);
      },
    );

    await f.test("re-enabling restores the directive", async () => {
      await write({ enabled: true });
      const agent = await create("Re-enabled");
      const { flags } = await launch(agent);
      assert.deepEqual(flags, [PASEO_FIRST_TEXT]);
      await f.client.archiveAgent(agent.id);
    });

    await f.test("unknown agents report an unknown state", async () => {
      assert.deepEqual(await status({ id: "never-created" }), {
        enabled: true,
        state: null,
      });
      await assert.rejects(
        f.rpc(PLUGIN, "paseo-omp-compat.status", { agentId: "" }),
      );
    });
  },
);
