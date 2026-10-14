import assert from "node:assert/strict";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { expect } from "@playwright/test";
import { ensureOb, root, runtime, until } from "./support/runtime.mjs";

const require = createRequire(join(root, "plugins/obsidian/package.json"));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const persistedAgent = async (home, id) => {
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
};

const syncProcesses = async () => {
  const found = [];
  for (const pid of (await readdir("/proc")).filter((name) =>
    /^\d+$/.test(name),
  )) {
    try {
      const command = await readFile(`/proc/${pid}/cmdline`, "utf8");
      if (command.includes("--continuous")) found.push({ pid, command });
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  return found;
};

const seedVault = async (home) => {
  const vault = join(home, "plugin-data", "obsidian", "vault");
  for (const directory of [
    "Inbox",
    "Projects/2026",
    "attachments",
    ".obsidian",
    ".trash",
    "Trash",
    ".paseo/skills",
  ])
    await mkdir(join(vault, directory), { recursive: true });
  await writeFile(join(vault, "Inbox", "A.md"), "# A\n\nweekly review notes\n");
  await writeFile(
    join(vault, "Projects", "2026", "Project plan.md"),
    "# Project plan\n\nroadmap for 2026\n",
  );
  await writeFile(
    join(vault, "Inbox", "Long note.md"),
    `# Long\n\n${"snapshot line\n".repeat(800)}`,
  );
  await writeFile(
    join(vault, "attachments", "image.png"),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]),
  );
  await writeFile(join(vault, ".obsidian", "app.json"), "{}");
  await writeFile(join(vault, ".trash", "deleted.md"), "gone\n");
  await writeFile(join(vault, "Trash", "deleted.md"), "gone\n");
  await writeFile(
    join(vault, ".paseo", "system.md"),
    "Vault conventions: keep notes short.\n",
  );
  await writeFile(
    join(vault, ".paseo", "skills", "alpha.md"),
    "---\nname: alpha\ndescription: First vault skill\n---\n\nbody alpha only\n",
  );
  await writeFile(
    join(vault, ".paseo", "skills", "beta.md"),
    "---\nname: beta\ndescription: Second vault skill\n---\n\nbody beta only\n",
  );
  await writeFile(
    join(vault, ".paseo", "skills", "gamma.md"),
    "no front matter here\n",
  );
  await symlink("/etc/passwd", join(vault, "escape.md"));
  return vault;
};

test(
  "obsidian serves a real vault to agents on an isolated daemon",
  { timeout: 900000 },
  async (t) => {
    const obBin = await ensureOb(t);
    const f = await runtime(t, {
      tools: ["opencode"],
      env: obBin ? { PATH: `${obBin}:${process.env.PATH}` } : {},
    });
    await f.install("obsidian");
    let mcp;
    let mcpServer;

    const status = () => f.rpc("obsidian", "obsidian.status", {});
    const call = async (name, args) => {
      const response = await mcp.callTool({ name, arguments: args });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      return JSON.parse(response.content[0].text);
    };
    const connect = async (agentId) => {
      const record = await until(
        () => persistedAgent(f.home, agentId),
        (value) => value?.config?.mcpServers?.obsidian !== undefined,
        30000,
      );
      mcpServer = record.config.mcpServers.obsidian;
      mcp = new Client({ name: "obsidian-e2e", version: "1.0.0" });
      t.after(async () => {
        await mcp.close();
      });
      await mcp.connect(
        new StreamableHTTPClientTransport(new URL(mcpServer.url), {
          requestInit: {
            headers: { Authorization: mcpServer.headers.Authorization },
          },
        }),
      );
      return record;
    };
    const writeSettings = async (values) => {
      const current = await f.rpc("obsidian", "settings.obsidian.read", {});
      assert.equal(current.status, "ready");
      const saved = await f.rpc("obsidian", "settings.obsidian.write", {
        revision: current.revision,
        values: { ...current.values, ...values },
      });
      assert.equal(saved.status, "saved", JSON.stringify(saved));
      return saved.values;
    };

    await f.test(
      "an unconfigured daemon reports the missing prerequisites without spawning sync",
      async () => {
        const view = await status();
        assert.equal(view.state, "unconfigured");
        assert.equal(view.pulling, false);
        assert.equal(view.error, null);
        assert.deepEqual(view.token, { stored: false, account: null });
        assert.equal(view.ob.source, "path");
        assert.ok(view.ob.path.endsWith("/ob"), view.ob.path ?? "");
        assert.equal(view.ob.version, "0.0.14");
        assert.equal(view.ob.minVersion, "0.0.14");
        assert.equal(view.vault, null);
        assert.equal(view.sync, null);
        assert.equal(view.lastSuccessAt, null);
        assert.equal(view.staleAfterSeconds, 900);
        assert.deepEqual(view.injection, {
          systemPrompt: {
            path: ".paseo/system.md",
            status: "not_injected",
            bytes: null,
            modifiedAt: null,
            name: null,
            description: null,
          },
          skills: [],
        });
        assert.deepEqual(await syncProcesses(), []);
        assert.deepEqual(
          await f.rpc("obsidian", "obsidian.vault.search", { query: "note" }),
          { items: [] },
        );
        await assert.rejects(
          f.rpc("obsidian", "obsidian.status", { extra: true }),
        );
        await assert.rejects(
          f.rpc("obsidian", "obsidian.vault.read", { path: 7 }),
        );
        const rejected = await f.rpc("obsidian", "obsidian.token.set", {
          token: "e2e-not-a-real-token",
        });
        assert.notEqual(rejected.status, "saved", JSON.stringify(rejected));
        assert.equal((await status()).token.stored, false);
        assert.equal(
          (await f.rpc("obsidian", "obsidian.token.clear", {})).status,
          "removed",
        );
      },
    );

    const vault = await seedVault(f.home);
    const agent = await f.createAgent(f.temporary, "Obsidian tools E2E");

    await f.test(
      "the real MCP gateway exposes four read tools over the seeded vault",
      async () => {
        const record = await connect(agent.id);
        const tools = await mcp.listTools();
        assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
          "glob_vault",
          "grep_vault",
          "list_vault",
          "read_vault",
        ]);
        assert.equal(
          tools.tools.some((tool) =>
            /write|create|update|delete|move|append|remove/i.test(tool.name),
          ),
          false,
        );
        assert.match(
          record.config.systemPrompt,
          /obsidian MCP server is read-only/,
        );

        const listing = await call("list_vault", {});
        assert.deepEqual(
          listing.entries.map((entry) => entry.path).sort(),
          [".paseo", "attachments", "Inbox", "Projects"].sort(),
        );
        assert.deepEqual(
          listing.entries.map((entry) => entry.type),
          ["folder", "folder", "folder", "folder"],
        );
        assert.equal(listing.truncated, false);
        assert.equal(listing.lastSyncedAt, null);
        assert.equal(listing.stale, false);
        assert.equal(listing.vault.name, null);
        const inbox = await call("list_vault", { path: "Inbox" });
        assert.deepEqual(
          inbox.entries.map((entry) => entry.name),
          ["A.md", "Long note.md"],
        );
        const nested = await call("list_vault", { path: "Projects", depth: 2 });
        assert.deepEqual(
          nested.entries.map((entry) => entry.path).sort(),
          ["Projects/2026", "Projects/2026/Project plan.md"].sort(),
        );
        const nestedTypes = new Map(
          nested.entries.map((entry) => [entry.path, entry.type]),
        );
        assert.equal(nestedTypes.get("Projects/2026"), "folder");
        assert.equal(nestedTypes.get("Projects/2026/Project plan.md"), "file");

        const globbed = await call("glob_vault", { pattern: "**/*.md" });
        assert.deepEqual(globbed.paths.sort(), [
          ".paseo/skills/alpha.md",
          ".paseo/skills/beta.md",
          ".paseo/skills/gamma.md",
          ".paseo/system.md",
          "Inbox/A.md",
          "Inbox/Long note.md",
          "Projects/2026/Project plan.md",
        ]);

        const grepped = await call("grep_vault", {
          query: "weekly",
          include: "Inbox/*.md",
        });
        assert.deepEqual(grepped.matches, [
          { path: "Inbox/A.md", line: 3, text: "weekly review notes" },
        ]);
        const regex = await call("grep_vault", {
          query: "^roadmap",
          regex: true,
        });
        assert.deepEqual(regex.matches, [
          {
            path: "Projects/2026/Project plan.md",
            line: 3,
            text: "roadmap for 2026",
          },
        ]);

        const note = await call("read_vault", { path: "Inbox/A.md" });
        assert.equal(note.text, "# A\n\nweekly review notes\n");
        assert.equal(note.truncated, false);
        assert.equal(note.path, "Inbox/A.md");
        assert.equal(typeof note.modifiedAt, "string");
        const window = await call("read_vault", {
          path: "Inbox/A.md",
          offset: 5,
          limit: 6,
        });
        assert.equal(window.text, "weekly");
        assert.equal(window.truncated, true);

        const denied = await call("read_vault", { path: "../../etc/passwd" });
        assert.equal(denied.error, "path_denied");
        const escape = await call("read_vault", { path: "escape.md" });
        assert.equal(escape.error, "path_denied");
        const hidden = await call("read_vault", { path: ".obsidian/app.json" });
        assert.equal(hidden.error, "path_denied");
        const trash = await call("read_vault", { path: ".trash/deleted.md" });
        assert.equal(trash.error, "path_denied");
        const publicTrash = await call("read_vault", {
          path: "Trash/deleted.md",
        });
        assert.equal(publicTrash.error, "path_denied");
        const missing = await call("read_vault", { path: "Inbox/missing.md" });
        assert.equal(missing.error, "not_found");
        const binary = await call("read_vault", {
          path: "attachments/image.png",
        });
        assert.equal(binary.error, "binary_file");
        assert.equal(binary.bytes, 7);
        assert.equal(typeof binary.modifiedAt, "string");

        const unauthenticated = await fetch(mcpServer.url, {
          method: "POST",
          body: "{}",
        });
        assert.equal(unauthenticated.status, 401);
        const wrongOrigin = await fetch(mcpServer.url, {
          method: "POST",
          headers: {
            Authorization: mcpServer.headers.Authorization,
            Origin: "https://example.org",
          },
          body: "{}",
        });
        assert.equal(wrongOrigin.status, 403);
      },
    );

    await f.test(
      "vault instructions are injected into new agents and skill bodies stay on demand",
      async () => {
        const created = await f.createAgent(
          f.temporary,
          "Obsidian injection E2E",
        );
        const record = await until(
          () => persistedAgent(f.home, created.id),
          (value) =>
            value?.config?.systemPrompt?.includes("Vault conventions") === true,
          30000,
        );
        const prompt = record.config.systemPrompt;
        assert.match(
          prompt,
          /list_vault, glob_vault, grep_vault and read_vault/,
        );
        assert.match(prompt, /Vault conventions: keep notes short\./);
        assert.doesNotMatch(prompt, /body alpha only/);
        assert.doesNotMatch(prompt, /body beta only/);
        assert.doesNotMatch(prompt, /gamma/);
        const alpha = prompt.indexOf("alpha: First vault skill");
        const beta = prompt.indexOf("beta: Second vault skill");
        assert.ok(alpha > 0 && beta > alpha, prompt);
        assert.match(prompt, /read_vault "\.paseo\/skills\/alpha\.md"/);
        assert.equal(record.config.mcpServers.obsidian.type, "http");

        const view = await until(
          status,
          (value) => value.injection.systemPrompt.status === "injected",
        );
        assert.ok((view.injection.systemPrompt.bytes ?? 0) > 0);
        assert.deepEqual(
          view.injection.skills.map((skill) => [
            skill.path,
            skill.status,
            skill.name,
            skill.description,
          ]),
          [
            [
              ".paseo/skills/alpha.md",
              "injected",
              "alpha",
              "First vault skill",
            ],
            [".paseo/skills/beta.md", "injected", "beta", "Second vault skill"],
            [".paseo/skills/gamma.md", "not_injected", null, null],
          ],
        );

        const body = await call("read_vault", {
          path: ".paseo/skills/alpha.md",
        });
        assert.match(body.text, /body alpha only/);

        await writeFile(
          join(vault, ".paseo", "system.md"),
          `# Big\n\n${"x".repeat(33 * 1024)}\n`,
        );
        const truncated = await until(
          status,
          (value) => value.injection.systemPrompt.status === "truncated",
        );
        assert.ok(
          (truncated.injection.systemPrompt.bytes ?? 0) > 32 * 1024,
          JSON.stringify(truncated.injection.systemPrompt),
        );
        const capped = await f.createAgent(f.temporary, "Obsidian cap E2E");
        const cappedRecord = await until(
          () => persistedAgent(f.home, capped.id),
          (value) =>
            value?.config?.systemPrompt?.includes("list_vault") === true,
          30000,
        );
        assert.ok(
          cappedRecord.config.systemPrompt.length < 40 * 1024,
          String(cappedRecord.config.systemPrompt.length),
        );

        await writeFile(
          join(vault, ".paseo", "system.md"),
          "Vault conventions: keep notes short.\n",
        );
        await until(
          status,
          (value) => value.injection.systemPrompt.status === "injected",
        );
      },
    );

    await f.test(
      "the attachment picker searches notes and snapshots them within budget",
      async () => {
        const items = await f.rpc("obsidian", "obsidian.vault.search", {
          query: "plan",
        });
        assert.equal(items.items.length, 1);
        const [item] = items.items;
        assert.equal(item.id, "Projects/2026/Project plan.md");
        assert.equal(item.identifier, "Projects/2026/Project plan.md");
        assert.equal(item.title, "Project plan");
        assert.equal(item.subtitle, "Projects/2026");
        assert.equal(item.resourceType, "obsidian-note");
        assert.ok(
          item.url.startsWith(
            "obsidian://open?vault=vault&file=Projects%2F2026%2F",
          ),
          item.url,
        );
        assert.match(item.text, /^<Projects\/2026\/Project plan\.md>/);
        assert.match(item.text, /roadmap for 2026/);
        assert.equal(item.text.endsWith("[truncated]"), false);

        const long = await f.rpc("obsidian", "obsidian.vault.search", {
          query: "Long note",
        });
        assert.equal(long.items.length, 1);
        assert.ok(long.items[0].text.endsWith("[truncated]"), "long note");
        assert.ok(long.items[0].text.length <= 8 * 1024, "snapshot budget");

        const empty = await f.rpc("obsidian", "obsidian.vault.search", {
          query: "",
        });
        assert.deepEqual(
          empty.items.map((entry) => entry.title),
          ["A", "Long note", "Project plan"],
        );
      },
    );

    await f.test(
      "a broken ob path is reported and recovers without a daemon restart",
      async () => {
        const settings = await writeSettings({ obPath: "/nonexistent/ob" });
        assert.equal(settings.obPath, "/nonexistent/ob");
        const broken = await until(
          status,
          (value) => value.ob.path === null && value.ob.source === null,
        );
        assert.equal(broken.state, "unconfigured");
        assert.equal(broken.ob.version, null);
        assert.deepEqual(await syncProcesses(), []);
        await writeSettings({ obPath: "" });
        const recovered = await until(
          status,
          (value) => value.ob.path !== null && value.ob.version === "0.0.14",
        );
        assert.equal(recovered.ob.source, "path");
        assert.deepEqual(await syncProcesses(), []);
        assert.equal(
          (await f.rpc("obsidian", "obsidian.remotes", {})).status,
          "token_missing",
        );
      },
    );

    await f.test(
      "the Web UI renders the composer picker, the vault screen and the settings screen",
      async () => {
        await writeSettings({ vaultId: "seeded", vaultName: "Work notes" });
        await until(status, (value) => value.vault?.name === "Work notes");
        const page = await f.openBrowser();
        await page.goto(f.url);
        await page
          .getByText(f.temporary.split("/").at(-1), { exact: true })
          .last()
          .click();
        const serverId = new URL(page.url()).pathname.match(
          /^\/h\/([^/]+)\//,
        )?.[1];
        assert.ok(serverId, page.url());
        await page.goto(
          `${new URL(page.url()).origin}/h/${serverId}/workspace/${agent.workspaceId}`,
        );
        const agentTab = page.getByText("Obsidian tools E2E", { exact: true });
        if ((await agentTab.count()) > 0) await agentTab.last().click();
        await page.getByRole("button", { name: "Add attachment" }).click();
        await page.getByText("Attach Obsidian vault", { exact: true }).click();
        await page
          .getByPlaceholder("Search notes by name or path")
          .fill("plan");
        await expect(
          page.getByText(/Projects\/2026\/Project plan\.md/).first(),
        ).toBeVisible();
        await page
          .getByText(/Projects\/2026\/Project plan\.md/)
          .first()
          .click();
        await expect(
          page.getByPlaceholder("Search notes by name or path"),
        ).toHaveCount(0);
        await expect(page.getByText(/Project plan/).first()).toBeVisible();

        await page.getByText("Obsidian vault", { exact: true }).first().click();
        await expect(
          page.getByText("Not set up", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Read-only", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("list_vault, glob_vault, grep_vault, read_vault", {
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByText("Work notes", { exact: true }).first(),
        ).toBeVisible();
        await expect(page.getByText("Skills", { exact: true })).toBeVisible();
        await expect(
          page.getByText("Description", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("Size", { exact: true })).toBeVisible();
        await expect(page.getByText("alpha", { exact: true })).toBeVisible();
        await expect(
          page.getByText("First vault skill", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Second vault skill", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(".paseo/skills/gamma.md", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Not injected", { exact: true }),
        ).toBeVisible();

        await page
          .getByRole("button", { name: "Open settings, Obsidian vault" })
          .click();
        await expect(
          page.getByText("Connection", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText("Set up", { exact: true })).toBeVisible();
        await expect(
          page
            .getByTestId("settings-detail-pane")
            .getByText("Path", { exact: true })
            .first(),
        ).toBeVisible();
        await expect(
          page
            .getByTestId("settings-detail-pane")
            .getByText("Injected", { exact: true })
            .first(),
        ).toBeVisible();
        await expect(
          page.getByText("First sync", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("To do", { exact: true }).last(),
        ).toBeVisible();
        await expect(
          page.getByText("No token stored", { exact: true }),
        ).toBeVisible();
        await expect(page.getByPlaceholder("Paste sync token")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Save token" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Remove token" }),
        ).toHaveCount(0);
        const addTokenButton = page.getByRole("button", { name: "Add token" });
        await expect(addTokenButton).toBeVisible();
        await addTokenButton.click();
        await expect(page.getByPlaceholder("Paste sync token")).toBeVisible();
        const saveTokenButton = page.getByRole("button", {
          name: "Save token",
        });
        const cancelTokenButton = page.getByRole("button", { name: "Cancel" });
        await expect(saveTokenButton).toBeVisible();
        const saveBox = await saveTokenButton.boundingBox();
        const cancelBox = await cancelTokenButton.boundingBox();
        assert.ok(saveBox && cancelBox, "both token actions are laid out");
        assert.ok(
          Math.abs(saveBox.y - cancelBox.y) < 4,
          `token actions share one row: ${String(saveBox.y)} vs ${String(cancelBox.y)}`,
        );
        assert.ok(saveBox.x < cancelBox.x, "save sits before cancel");
        await cancelTokenButton.click();
        await expect(page.getByPlaceholder("Paste sync token")).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Add token" }),
        ).toBeVisible();
        await expect(
          page
            .getByTestId("settings-detail-pane")
            .getByText("Obsidian CLI (ob)", { exact: true })
            .first(),
        ).toBeVisible();
        await expect(page.getByText(/Found: .*\/ob$/)).toBeVisible();
        await expect(
          page.getByText("ob 0.0.14, minimum 0.0.14", { exact: true }),
        ).toBeVisible();
        await expect(page.getByPlaceholder("Path or name of ob")).toHaveCount(
          0,
        );
        await writeSettings({ obPath: "/nonexistent/ob" });
        await until(
          status,
          (value) => value.ob.source === null && value.ob.path === null,
        );
        await expect(page.getByPlaceholder("Path or name of ob")).toBeVisible({
          timeout: 20000,
        });
        await writeSettings({ obPath: "" });
        await until(
          status,
          (value) => value.ob.source === "path" && value.ob.path !== null,
        );
        await expect(page.getByPlaceholder("Path or name of ob")).toHaveCount(
          0,
          { timeout: 20000 },
        );
        await expect(
          page
            .getByTestId("settings-detail-pane")
            .getByText("Vault", { exact: true })
            .first(),
        ).toBeVisible();
        await expect(
          page.getByText("Work notes (Not found)", { exact: true }),
        ).toBeVisible();
      },
    );

    await f.test(
      "removing the token deletes the local copy and disables vault reads",
      async () => {
        assert.equal(
          (await f.rpc("obsidian", "obsidian.token.clear", {})).status,
          "removed",
        );
        const view = await until(status, (value) => value.vault !== null);
        assert.equal(view.token.stored, false);
        assert.deepEqual(
          await readdir(vault).catch((error) => error.code),
          "ENOENT",
        );
        assert.equal((await call("list_vault", {})).error, "vault_unavailable");
        assert.equal(
          (await call("read_vault", { path: "Inbox/A.md" })).error,
          "vault_unavailable",
        );
        assert.deepEqual(
          await f.rpc("obsidian", "obsidian.vault.search", { query: "plan" }),
          { items: [] },
        );
        assert.equal(
          (await f.rpc("obsidian", "obsidian.sync.now", {})).status,
          "unconfigured",
        );
      },
    );
  },
);
