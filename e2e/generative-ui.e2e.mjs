import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { expect } from "@playwright/test";
import { command, root, runtime, until } from "./support/runtime.mjs";

const require = createRequire(join(root, "plugins/generative-ui/package.json"));
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
  StreamableHTTPClientTransport,
} = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

test(
  "generative-ui renders and interacts through a real daemon and MCP",
  { timeout: 240000 },
  async (t) => {
    const f = await runtime(t);
    await f.install("generative-ui");
    const agent = await f.createAgent(f.temporary, "Generative UI E2E");
    const other = await f.createAgent(f.temporary, "Other UI agent");
    const connection = await f.rpc(
      "generative-ui",
      "generative-ui.connection",
      { agentId: agent.id },
    );
    const mcp = new Client({ name: "generative-ui-e2e", version: "1.0.0" });
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
      return JSON.parse(response.content[0].text);
    };
    const form = JSON.parse(
      await readFile(
        join(
          root,
          "plugins/generative-ui/skills/generative-ui/assets/choice-form.json",
        ),
        "utf8",
      ),
    );
    const table = JSON.parse(
      await readFile(
        join(
          root,
          "plugins/generative-ui/skills/generative-ui/assets/comparison-table.json",
        ),
        "utf8",
      ),
    );
    let page;
    const gallery = JSON.parse(
      await readFile(join(root, "e2e/fixtures/generative-ui.json"), "utf8"),
    );
    let galleryRevision = 1;
    const updateGallery = async (patches) => {
      const card = await call("patch_ui", {
        cardId: gallery.cardId,
        revision: galleryRevision,
        complete: true,
        patches,
      });
      galleryRevision = card.revision;
      return card;
    };
    const coveredComponents = new Set();

    await f.test(
      "the package includes the skill and the real MCP exposes its guide and catalog",
      async () => {
        const tools = await mcp.listTools();
        assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
          "close_ui",
          "get_ui_catalog",
          "get_ui_guide",
          "get_ui_state",
          "patch_ui",
          "publish_ui",
        ]);
        const guide = await mcp.callTool({
          name: "get_ui_guide",
          arguments: {},
        });
        assert.match(guide.content[0].text, /name: generative-ui/);
        assert.match(guide.content[0].text, /assets\/choice-form.json/);
        assert.match(guide.content[0].text, /references\/interactions.md/);
        const resource = await mcp.readResource({
          uri: "skill://generative-ui/SKILL.md",
        });
        assert.equal(resource.contents[0].text, guide.content[0].text);
        const catalog = await call("get_ui_catalog", {});
        assert.equal(Object.keys(catalog.components).length, 14);
        const archive = join(f.temporary, "generative-ui.tgz");
        await command(
          "pnpm",
          [
            "--filter",
            "@paseo-plugins/generative-ui",
            "pack",
            "--out",
            archive,
          ],
          { cwd: root },
        );
        const files = await command("tar", ["-tf", archive]);
        for (const path of [
          "skills/generative-ui/SKILL.md",
          "skills/generative-ui/agents/openai.yaml",
          "skills/generative-ui/assets/choice-form.json",
          "shared/guide.generated.ts",
          "index.client.tsx",
          "index.server.ts",
        ])
          assert.ok(files.includes(`package/${path}`), path);
        const unauthenticated = await fetch(connection.url, {
          method: "POST",
          body: "{}",
        });
        assert.equal(unauthenticated.status, 401);
        const wrongOrigin = await fetch(connection.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.token}`,
            Origin: "https://example.org",
          },
          body: "{}",
        });
        assert.equal(wrongOrigin.status, 403);
      },
    );

    await f.test(
      "native cards appear in Chat with real accessible form controls",
      async () => {
        const published = await call("publish_ui", form);
        assert.equal(published.revision, 1);
        assert.deepEqual(
          (
            await f.rpc("generative-ui", "generative-ui.list", {
              agentId: other.id,
            })
          ).cards,
          [],
        );
        await call("publish_ui", table);
        page = await f.openBrowser();
        await page.goto(f.url);
        await page
          .getByText(f.temporary.split("/").at(-1), { exact: true })
          .last()
          .click();
        await page.goto(
          page
            .url()
            .replace(/\/workspace\/[^/?]+/, `/workspace/${agent.workspaceId}`),
        );
        await expect(
          page.getByText("Implementation preferences", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("radio", { name: "Core flow", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("textbox", { name: "Notes", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("checkbox", { name: "Mobile support", exact: true }),
        ).toBeChecked();
        await expect(
          page.getByRole("button", { name: "Submit preferences", exact: true }),
        ).toBeEnabled();
        await expect(
          page.getByText(table.spec.elements.card.props.title, { exact: true }),
        ).toBeVisible();
        const timeline = await f.client.fetchAgentTimeline(agent.id);
        assert.ok(
          timeline.entries.some(
            (entry) =>
              entry.item.type === "plugin" &&
              entry.item.pluginId === "generative-ui",
          ),
        );
      },
    );

    await f.test(
      "publish the component gallery through the real MCP transport",
      async () => {
        await call("publish_ui", gallery);
        await expect(
          page.getByText("Component gallery", { exact: true }),
        ).toBeVisible();
      },
    );
    const componentCases = {
      Card: async () => {
        const card = page
          .getByText("Component gallery", { exact: true })
          .locator("..");
        await expect(
          card.getByText("Readable results", { exact: true }),
        ).toBeVisible();
        await expect(
          card.getByText("Matching records", { exact: true }),
        ).toBeVisible();
        await expect(
          card.getByRole("progressbar", {
            name: "Indexing progress",
            exact: true,
          }),
        ).toBeVisible();
      },
      Stack: async () => {
        const left = await page
          .getByText("Left column", { exact: true })
          .boundingBox();
        const right = await page
          .getByText("Right column", { exact: true })
          .boundingBox();
        assert.ok(left && right);
        assert.ok(Math.abs(left.y - right.y) < 2);
        assert.ok(right.x > left.x + left.width);
      },
      Text: async () => {
        const body = page.getByText("Readable body · 可复制的内容", {
          exact: true,
        });
        await expect(body).toBeVisible();
        await expect(body).toHaveCSS("user-select", "text");
      },
      Heading: async () => {
        await expect(
          page.getByRole("heading", { name: "Readable results", exact: true }),
        ).toBeVisible();
      },
      Divider: async () => {
        const divider = page.getByTestId("generative-ui-divider");
        await expect(divider).toBeVisible();
        const box = await divider.boundingBox();
        assert.ok(box && box.height > 0 && box.height < 4 && box.width > 200);
      },
      Metric: async () => {
        const metric = page
          .getByText("Matching records", { exact: true })
          .locator("..");
        await expect(metric.getByText("12", { exact: true })).toBeVisible();
        await expect(
          metric.getByText("Verified records", { exact: true }),
        ).toBeVisible();
        await updateGallery([
          { op: "replace", path: "/state/data/count", value: 18 },
        ]);
        await expect(metric.getByText("18", { exact: true })).toBeVisible();
      },
      Badge: async () => {
        const badge = page.getByText("Healthy status", { exact: true });
        await expect(badge).toBeVisible();
        const successColor = await badge.evaluate(
          (element) => getComputedStyle(element).color,
        );
        await updateGallery([
          {
            op: "replace",
            path: "/elements/badge/props/tone",
            value: "warning",
          },
          {
            op: "replace",
            path: "/elements/badge/props/label",
            value: "Review status",
          },
        ]);
        const warning = page.getByText("Review status", { exact: true });
        await expect(warning).toBeVisible();
        assert.notEqual(
          await warning.evaluate((element) => getComputedStyle(element).color),
          successColor,
        );
      },
      Progress: async () => {
        const progress = page.getByRole("progressbar", {
          name: "Indexing progress",
          exact: true,
        });
        await expect(progress).toHaveAttribute("aria-valuemin", "0");
        await expect(progress).toHaveAttribute("aria-valuemax", "100");
        await expect(progress).toHaveAttribute("aria-valuenow", "75");
        await updateGallery([
          { op: "replace", path: "/state/data/progress", value: 0.9 },
        ]);
        await expect(progress).toHaveAttribute("aria-valuenow", "90");
        const rejected = await mcp.callTool({
          name: "patch_ui",
          arguments: {
            cardId: gallery.cardId,
            revision: galleryRevision,
            complete: true,
            patches: [
              { op: "replace", path: "/state/data/progress", value: 1.5 },
            ],
          },
        });
        assert.equal(rejected.isError, true);
        await expect(progress).toHaveAttribute("aria-valuenow", "90");
      },
      KeyValue: async () => {
        const fact = page
          .getByText("Feature enabled", { exact: true })
          .locator("..");
        await expect(fact.getByText("true", { exact: true })).toBeVisible();
        await updateGallery([
          { op: "replace", path: "/state/data/enabled", value: false },
        ]);
        await expect(fact.getByText("false", { exact: true })).toBeVisible();
      },
      Table: async () => {
        await expect(page.getByText("Approach", { exact: true })).toBeVisible();
        await expect(
          page.getByText("Inline stream", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Persistent updates", { exact: true }),
        ).toBeVisible();
      },
      ChoiceGroup: async () => {
        const core = page.getByRole("radio", {
          name: "Core flow",
          exact: true,
        });
        const extended = page.getByRole("radio", {
          name: "Include extensions",
          exact: true,
        });
        await expect(core).toBeChecked();
        await extended.click();
        await expect(extended).toBeChecked();
        await expect(core).not.toBeChecked();
        await core.click();
      },
      TextInput: async () => {
        const notes = page.getByRole("textbox", { name: "Notes", exact: true });
        await notes.fill("Typed requirements");
        await expect(notes).toHaveValue("Typed requirements");
        await notes.fill("");
      },
      Checkbox: async () => {
        const mobile = page.getByRole("checkbox", {
          name: "Mobile support",
          exact: true,
        });
        await mobile.click();
        await expect(mobile).not.toBeChecked();
        await mobile.click();
        await expect(mobile).toBeChecked();
      },
    };
    for (const [type, body] of Object.entries(componentCases)) {
      await f.test(`${type}: native component behavior in Paseo Chat`, body);
      coveredComponents.add(type);
    }

    await f.test(
      "ordered patches update Chat without resetting a draft and invalid edits are atomic",
      async () => {
        await page
          .getByRole("textbox", { name: "Notes", exact: true })
          .fill("Preserve my draft");
        await page
          .getByRole("radio", { name: "Include extensions", exact: true })
          .click();
        const update = await call("patch_ui", {
          cardId: form.cardId,
          revision: 1,
          complete: false,
          patches: [
            {
              op: "replace",
              path: "/elements/card/props/title",
              value: "Updated preferences",
            },
          ],
        });
        assert.equal(update.status, "streaming");
        await expect(
          page.getByText("Updated preferences", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Submit preferences", exact: true }),
        ).toBeDisabled();
        await call("patch_ui", {
          cardId: form.cardId,
          revision: 2,
          complete: true,
          patches: [
            {
              op: "replace",
              path: "/elements/card/props/title",
              value: "Ready preferences",
            },
          ],
        });
        await expect(
          page.getByRole("textbox", { name: "Notes", exact: true }),
        ).toHaveValue("Preserve my draft");
        await expect(
          page.getByRole("radio", { name: "Include extensions", exact: true }),
        ).toBeChecked();
        for (const patches of [
          [
            {
              op: "replace",
              path: "/elements/card/props/title",
              value: "Never committed",
            },
            { op: "add", path: "/elements/card/children/-", value: "card" },
          ],
          [{ op: "add", path: "/state/__proto__/polluted", value: true }],
          [{ op: "replace", path: "/elements/card/props/title", value: 123 }],
          [
            {
              op: "replace",
              path: "/elements/missing/props/text",
              value: "Missing",
            },
          ],
        ]) {
          const rejected = await mcp.callTool({
            name: "patch_ui",
            arguments: {
              cardId: form.cardId,
              revision: 3,
              complete: true,
              patches,
            },
          });
          assert.equal(rejected.isError, true, JSON.stringify(rejected));
        }
        assert.equal(
          (await call("get_ui_state", { cardId: form.cardId })).card.revision,
          3,
        );
        const conflict = await mcp.callTool({
          name: "patch_ui",
          arguments: {
            cardId: form.cardId,
            revision: 1,
            complete: true,
            patches: [
              {
                op: "replace",
                path: "/elements/card/props/title",
                value: "Stale",
              },
            ],
          },
        });
        assert.equal(conflict.isError, true);
        await assert.rejects(
          f.rpc("generative-ui", "generative-ui.submit", {
            agentId: agent.id,
            cardId: form.cardId,
            revision: 3,
            eventId: "invalid-event",
            values: { scope: "unknown", notes: "", mobile: true },
          }),
          /Invalid Scope choice/,
        );
        const rowsPath = "/elements/table/props/rows/-";
        const patchedTable = await call("patch_ui", {
          cardId: table.cardId,
          revision: 1,
          complete: true,
          patches: [
            { op: "add", path: rowsPath, value: ["Duplicate", "Same"] },
            { op: "add", path: rowsPath, value: ["Duplicate", "Same"] },
          ],
        });
        assert.deepEqual(
          patchedTable.spec.elements.table.props.rows.slice(-2),
          [
            ["Duplicate", "Same"],
            ["Duplicate", "Same"],
          ],
        );
        await expect(page.getByText("Duplicate", { exact: true })).toHaveCount(
          2,
        );
      },
    );

    await f.test(
      "Button: clicking Submit stores the values and delivers a real user message to the same agent",
      async () => {
        await page
          .getByRole("checkbox", { name: "Mobile support", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Submit preferences", exact: true })
          .click();
        await expect(
          page.getByText(
            /^(Submitted|Submission saved; waiting for the agent\.)$/,
          ),
        ).toBeVisible();
        const saved = await call("get_ui_state", { cardId: form.cardId });
        assert.equal(saved.card.submitted, true);
        assert.deepEqual(saved.values, {
          scope: "extended",
          notes: "Preserve my draft",
          mobile: false,
        });
        await expect(
          page.getByRole("button", { name: "Submit preferences", exact: true }),
        ).toBeDisabled();
        const timeline = await until(
          () => f.client.fetchAgentTimeline(agent.id),
          (timeline) =>
            timeline.entries.some(
              (entry) =>
                entry.item.type === "user_message" &&
                entry.item.text.includes("generative-ui.submit"),
            ),
          60000,
        );
        const message = timeline.entries.find(
          (entry) =>
            entry.item.type === "user_message" &&
            entry.item.text.includes("generative-ui.submit"),
        );
        const event = JSON.parse(message.item.text.split("\n").at(-1));
        assert.deepEqual(event.values, saved.values);
        await f.rpc("generative-ui", "generative-ui.submit", {
          agentId: agent.id,
          cardId: form.cardId,
          revision: 3,
          eventId: event.eventId,
          values: saved.values,
        });
        const messages = (
          await f.client.fetchAgentTimeline(agent.id)
        ).entries.filter(
          (entry) =>
            entry.item.type === "user_message" &&
            entry.item.text.includes("generative-ui.submit"),
        );
        assert.equal(messages.length, 1);
        assert.equal(
          (await f.client.fetchAgentTimeline(other.id)).entries.some(
            (entry) =>
              entry.item.type === "user_message" &&
              entry.item.text.includes("generative-ui.submit"),
          ),
          false,
        );
      },
    );
    coveredComponents.add("Button");
    assert.deepEqual(
      Array.from(coveredComponents).sort(),
      Object.keys((await call("get_ui_catalog", {})).components).sort(),
      "Every supported component must have a real E2E scenario",
    );

    await f.test(
      "reload preserves MCP address, cards and submitted values; closing disables a card",
      async () => {
        assert.equal(
          (await f.client.reloadPlugin("generative-ui")).status,
          "running",
        );
        const reloaded = await f.rpc(
          "generative-ui",
          "generative-ui.connection",
          { agentId: agent.id },
        );
        assert.deepEqual(reloaded, connection);
        const saved = await call("get_ui_state", { cardId: form.cardId });
        assert.equal(saved.card.submitted, true);
        assert.equal(saved.values.notes, "Preserve my draft");
        await page.reload();
        await expect(
          page.getByRole("textbox", { name: "Notes", exact: true }),
        ).toHaveValue("Preserve my draft");
        await expect(
          page.getByRole("button", { name: "Submit preferences", exact: true }),
        ).toBeDisabled();
        await call("close_ui", { cardId: table.cardId, revision: 2 });
        await expect(page.getByText("Closed", { exact: true })).toBeVisible();
        assert.equal(
          (await call("get_ui_state", { cardId: table.cardId })).card.status,
          "closed",
        );
        const otherConnection = await f.rpc(
          "generative-ui",
          "generative-ui.connection",
          { agentId: other.id },
        );
        const otherMcp = new Client({ name: "other-ui-e2e", version: "1.0.0" });
        try {
          await otherMcp.connect(
            new StreamableHTTPClientTransport(new URL(otherConnection.url), {
              requestInit: {
                headers: { Authorization: `Bearer ${otherConnection.token}` },
              },
            }),
          );
          const result = await otherMcp.callTool({
            name: "get_ui_state",
            arguments: { cardId: form.cardId },
          });
          assert.equal(result.isError, true);
        } finally {
          await otherMcp.close();
        }
      },
    );
  },
);
