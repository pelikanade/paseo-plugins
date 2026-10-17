import assert from "node:assert/strict";
import test from "node:test";
import { expect } from "@playwright/test";
import { runtime, until } from "./support/runtime.mjs";

test(
  "host-monitor samples the daemon host and renders in the sidebar footer",
  { timeout: 240000 },
  async (t) => {
    const f = await runtime(t);
    await f.install("host-monitor");

    await f.test(
      "the RPC reports plausible live metrics over the real daemon transport",
      async () => {
        const first = await f.rpc("host-monitor", "host-monitor.sample", {});
        assert.match(first.host.hostname, /\S/);
        assert.ok(first.host.cores >= 1);
        assert.equal(first.cpu.perCorePct.length, first.host.cores);
        assert.ok(first.cpu.usagePct >= 0 && first.cpu.usagePct <= 100);
        for (const usage of first.cpu.perCorePct)
          assert.ok(usage >= 0 && usage <= 100);
        assert.ok(first.memory.totalBytes > 0);
        assert.equal(
          first.memory.usedBytes + first.memory.availableBytes,
          first.memory.totalBytes,
        );
        assert.ok(first.memory.usagePct >= 0 && first.memory.usagePct <= 100);
        assert.equal(first.load.supported, true);
        assert.ok(first.load.one >= 0);
        assert.ok(first.load.five >= 0);
        assert.ok(first.load.fifteen >= 0);
        for (const key of ["sampledAt", "cpu", "memory", "load"])
          assert.equal(
            first.history[key].length,
            first.history.sampledAt.length,
          );
        assert.ok(first.history.sampledAt.length >= 1);
        await assert.rejects(
          f.rpc("host-monitor", "host-monitor.sample", { extra: true }),
        );

        const later = await until(
          () => f.rpc("host-monitor", "host-monitor.sample", {}),
          (sample) =>
            sample.sampledAt > first.sampledAt &&
            sample.history.sampledAt.length > first.history.sampledAt.length,
          10000,
        );
        assert.ok(later.sampledAt > first.sampledAt);
        assert.ok(later.history.cpu.length <= 60);

        assert.equal(
          (await f.client.reloadPlugin("host-monitor")).status,
          "running",
        );
        const reloaded = await until(
          () => f.rpc("host-monitor", "host-monitor.sample", {}),
          (sample) => sample.host.cores >= 1,
          10000,
        );
        assert.ok(reloaded.memory.totalBytes > 0);
      },
    );

    await f.test(
      "the footer shows live values and the popover shows details and trends",
      async () => {
        const page = await f.openBrowser();
        await page.goto(f.url);
        const trigger = page.getByRole("button", {
          name: /^Host monitor: CPU/,
        });
        await expect(trigger).toBeVisible();
        await expect(trigger).toContainText("CPU");
        await expect(trigger).toContainText("MEM");
        await expect(trigger).toContainText("LOAD");
        await expect(trigger).toContainText("%");
        await trigger.click();
        await expect(
          page.getByText("Load average", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText(/1m \/ 5m \/ 15m/)).toBeVisible();
        await expect(page.getByText(/of .* used/)).toBeVisible();
        await expect(page.getByText(/Kernel /)).toBeVisible();
        await expect(page.getByText(/refreshes every 2s/)).toBeVisible();
        await page.getByRole("button", { name: "Close host monitor" }).click();
        await expect(
          page.getByText("Load average", { exact: true }),
        ).toHaveCount(0);
      },
    );
  },
);
