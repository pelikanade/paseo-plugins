import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { expect } from "@playwright/test";
import { command, root, runtime } from "./support/runtime.mjs";

test(
  "paseo-omp-optimize renders images read by an OMP session",
  { timeout: 240000 },
  async (t) => {
    const f = await runtime(t, {
      providers: { omp: { enabled: true } },
    });
    await f.install("paseo-omp-optimize");
    const cwd = join(f.temporary, "project");
    await mkdir(cwd, { recursive: true });
    const sourceImage = join(root, "e2e/fixtures/omp-read-image.png");
    await copyFile(sourceImage, join(cwd, "shot.png"));
    let model;
    try {
      const listed = JSON.parse(await command("omp", ["models", "--json"]));
      model = listed.models.find((entry) => entry.kind === "chat");
    } catch (error) {
      throw new Error(
        `The paseo-omp-optimize E2E scenario needs the omp CLI and a configured chat model: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    assert.ok(
      model,
      "The paseo-omp-optimize E2E scenario needs at least one configured OMP chat model",
    );
    const timestamp = "2026-10-18T00:00:00.000Z";
    const sessionId = "0190f0e0-0000-7000-8000-000000000001";
    const sessionFile = join(f.temporary, "omp-session.jsonl");
    const imageText =
      "Read image file [image/png]\n[Image: original 32x24, displayed at 32x24. Multiply coordinates by 1.00 to map to original image.]";
    await writeFile(
      sessionFile,
      `${[
        { type: "session", version: 3, id: sessionId, timestamp, cwd },
        {
          type: "model_change",
          id: "model",
          parentId: null,
          timestamp,
          model: model.selector,
        },
        {
          type: "message",
          id: "user",
          parentId: "model",
          timestamp,
          message: {
            role: "user",
            content: [{ type: "text", text: "Read shot.png" }],
          },
        },
        {
          type: "message",
          id: "assistant",
          parentId: "user",
          timestamp,
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "call_image",
                name: "read",
                arguments: { path: "shot.png" },
              },
            ],
          },
        },
        {
          type: "message",
          id: "result",
          parentId: "assistant",
          timestamp,
          message: {
            role: "toolResult",
            toolCallId: "call_image",
            toolName: "read",
            content: [
              { type: "text", text: imageText },
              {
                type: "image",
                data: "blob:sha256:0000",
                mimeType: "image/png",
              },
            ],
            details: {},
          },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n")}\n`,
    );
    const agent = await f.client.importAgent({
      provider: "omp",
      sessionId: sessionFile,
      cwd,
    });

    await f.test(
      "the daemon maps the OMP image result to a read tool call",
      async () => {
        const timeline = await f.client.fetchAgentTimeline(agent.id);
        const read = timeline.entries.find(
          (entry) =>
            entry.item.type === "tool_call" &&
            entry.item.detail.type === "read" &&
            entry.item.detail.filePath === "shot.png",
        );
        assert.ok(read, JSON.stringify(timeline.entries));
        assert.equal(read.item.status, "completed");
        assert.match(
          read.item.detail.content ?? "",
          /^Read image file \[image\/png\]/,
        );
      },
    );

    await f.test(
      "the RPC reads the original image relative to the agent cwd",
      async () => {
        const result = await f.rpc(
          "paseo-omp-optimize",
          "paseo-omp-optimize.read-image",
          { agentId: agent.id, filePath: "shot.png" },
        );
        assert.equal(result.mimeType, "image/png");
        assert.equal(result.fileName, "shot.png");
        assert.equal(
          result.byteLength,
          (await readFile(sourceImage)).byteLength,
        );
        assert.deepEqual(
          Buffer.from(result.base64, "base64"),
          await readFile(sourceImage),
        );
        await assert.rejects(
          f.rpc("paseo-omp-optimize", "paseo-omp-optimize.read-image", {
            agentId: agent.id,
            filePath: "missing.png",
          }),
        );
      },
    );

    await f.test(
      "the timeline replaces the OMP read row with the rendered image",
      async () => {
        const page = await f.openBrowser();
        await page.goto(f.url);
        await page.getByText("project", { exact: true }).last().click();
        await page.goto(
          page
            .url()
            .replace(/\/workspace\/[^/?]+/, `/workspace/${agent.workspaceId}`),
        );
        const row = page.getByTestId("paseo-omp-read-image");
        await expect(row).toBeVisible();
        await expect(row.getByText("shot.png")).toBeVisible();
        const image = row.getByRole("img", {
          name: "Image read from shot.png",
        });
        await expect(image).toBeVisible();
        assert.deepEqual(
          await image.locator("img").evaluate((element) => ({
            width: element.naturalWidth,
            height: element.naturalHeight,
          })),
          { width: 32, height: 24 },
        );
        await expect(row.getByText(/^Read image file /)).toHaveCount(0);
      },
    );
  },
);
