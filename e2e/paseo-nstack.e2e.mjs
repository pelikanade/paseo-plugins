import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { expect } from "@playwright/test";
import { runtime, until } from "./support/runtime.mjs";
import { githubFixture } from "./support/nstack.mjs";

test(
  "paseo-nstack dispatches once per workspace and survives restart",
  { timeout: 240000 },
  async (t) => {
    const fixture = await githubFixture(t);
    const f = await runtime(t, {
      env: {
        GH_TOKEN: "e2e-token",
        PASEO_NSTACK_GITHUB_HOST: "github.com",
        PASEO_NSTACK_GITHUB_REST_URL: fixture.baseUrl,
      },
      tools: ["devenv", "opencode", "gh"],
    });
    const project = await f.project("nstack project", "nstack");
    const seed = await f.createAgent(project, "nstack workspace");
    await f.install("paseo-nstack");

    const initial = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    const provider = initial.providerOptions.find(
      (option) => option.provider === "opencode" && option.supportsWrite,
    );
    assert.ok(provider, JSON.stringify(initial.providerOptions));
    const defaults = {
      automaticStarts: true,
      agent: { provider: provider.provider, model: provider.model },
    };
    const binding = {
      repository: { owner: "acme", name: "repo" },
      paused: false,
      checkEverySeconds: 86400,
      repairEverySeconds: 3600,
      agent: null,
    };

    await f.rpc("paseo-nstack", "nstack.settings.save", {
      workspaceId: seed.workspaceId,
      defaults,
      binding: { workspaceId: seed.workspaceId, ...binding },
    });

    const first = await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    assert.deepEqual(first, { observed: 1, started: 1, handled: 0, errors: 0 });
    const second = await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    assert.deepEqual(second, {
      observed: 0,
      started: 0,
      handled: 1,
      errors: 0,
    });

    const agents = await until(
      () =>
        f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        }),
      (page) => page.entries.length === 1,
    );
    const spawned = agents.entries[0].agent;
    assert.equal(spawned.workspaceId, seed.workspaceId);
    assert.equal(spawned.title, "nstack · Issue #42 is Ready");
    assert.equal(spawned.labels["paseo-nstack-signal"], "ready:42:4201");

    const timeline = await f.client.fetchAgentTimeline(spawned.id);
    assert.ok(
      timeline.entries.some(
        (entry) =>
          entry.item.type === "plugin" &&
          entry.item.pluginId === "paseo-nstack" &&
          entry.item.kind === "nstack-agent-started",
      ),
    );
    const statePath = join(f.home, "plugin-data", "paseo-nstack", "state.json");
    const ambiguousState = JSON.parse(await readFile(statePath, "utf8"));
    const ambiguousLaunch = ambiguousState.launches.find(
      (launch) => launch.agentId === spawned.id,
    );
    assert.ok(ambiguousLaunch);
    ambiguousLaunch.state = "failed";
    ambiguousLaunch.error = "Connection lost after agent creation";
    await writeFile(statePath, JSON.stringify(ambiguousState));
    await f.client.reloadPlugin("paseo-nstack");
    assert.deepEqual(
      await f.rpc("paseo-nstack", "nstack.check.now", {
        workspaceId: seed.workspaceId,
      }),
      { observed: 0, started: 0, handled: 1, errors: 0 },
    );
    assert.equal(
      (
        await f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        })
      ).entries.length,
      1,
    );
    const recoveredTimeline = await f.client.fetchAgentTimeline(spawned.id);
    assert.equal(
      recoveredTimeline.entries.filter(
        (entry) =>
          entry.item.type === "plugin" &&
          entry.item.pluginId === "paseo-nstack" &&
          entry.item.kind === "nstack-agent-started",
      ).length,
      1,
    );

    const panel = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(panel.status, "watching");
    assert.equal(panel.counts.ready, 1);
    assert.equal(
      panel.activity.filter((entry) => entry.kind === "started").length,
      1,
    );
    await f.rpc("paseo-nstack", "nstack.pause.set", {
      scope: "workspace",
      workspaceId: seed.workspaceId,
      paused: true,
    });
    fixture.state.pulls.push({
      number: 7,
      title: "Add the worker",
      html_url: "https://github.com/acme/repo/pull/7",
      state: "open",
      created_at: "2026-01-02T04:00:00.000Z",
      updated_at: "2026-01-02T04:00:00.000Z",
      closed_at: null,
      merged_at: null,
      head: { sha: "pr-7-a" },
    });
    fixture.state.statuses.set("main", {
      state: "failure",
      sha: "main-sha-2",
      total_count: 1,
    });
    fixture.state.statuses.set("pr-7-a", {
      state: "success",
      sha: "pr-7-a",
      total_count: 1,
    });
    fixture.state.issueComments.push({
      id: 9001,
      body: "/retry",
      html_url: "https://github.com/acme/repo/issues/42#issuecomment-9001",
      created_at: "2026-01-02T04:01:00.000Z",
      updated_at: "2026-01-02T04:01:00.000Z",
      user: { login: "human" },
      issue_url: "https://api.github.com/repos/acme/repo/issues/42",
    });
    const whilePaused = await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    assert.deepEqual(whilePaused, {
      observed: 3,
      started: 0,
      handled: 1,
      errors: 0,
    });
    assert.equal(
      (
        await f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        })
      ).entries.length,
      1,
    );
    await f.rpc("paseo-nstack", "nstack.pause.set", {
      scope: "workspace",
      workspaceId: seed.workspaceId,
      paused: false,
    });
    const resumedAgents = await until(
      () =>
        f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        }),
      (result) => result.entries.length === 4,
    );
    assert.ok(
      resumedAgents.entries.every(
        (entry) => entry.agent.workspaceId === seed.workspaceId,
      ),
    );
    const editedCommand = fixture.state.issueComments[0];
    assert.ok(editedCommand);
    editedCommand.body = "/retry with more context";
    editedCommand.updated_at = "2026-01-02T04:01:30.000Z";
    assert.deepEqual(
      await f.rpc("paseo-nstack", "nstack.check.now", {
        workspaceId: seed.workspaceId,
      }),
      { observed: 0, started: 0, handled: 2, errors: 0 },
    );
    fixture.state.issueComments.length = 0;
    const checkSignals = () =>
      f.rpc("paseo-nstack", "nstack.check.now", {
        workspaceId: seed.workspaceId,
      });
    const pull7 = fixture.state.pulls[0];
    assert.ok(pull7);
    pull7.head.sha = "pr-7-b";
    pull7.updated_at = "2026-01-02T04:02:00.000Z";
    fixture.state.statuses.set("pr-7-b", {
      state: "success",
      sha: "pr-7-b",
      total_count: 1,
    });
    assert.deepEqual(await checkSignals(), {
      observed: 2,
      started: 2,
      handled: 1,
      errors: 0,
    });

    pull7.state = "closed";
    pull7.merged_at = "2026-01-02T04:03:00.000Z";
    pull7.closed_at = "2026-01-02T04:03:00.000Z";
    pull7.updated_at = new Date(Date.now() + 1000).toISOString();
    assert.deepEqual(await checkSignals(), {
      observed: 1,
      started: 1,
      handled: 1,
      errors: 0,
    });

    const pull8 = {
      number: 8,
      title: "Close unused work",
      html_url: "https://github.com/acme/repo/pull/8",
      state: "open",
      created_at: "2026-01-02T04:04:00.000Z",
      updated_at: "2026-01-02T04:04:00.000Z",
      closed_at: null,
      merged_at: null,
      head: { sha: "pr-8-a" },
    };
    fixture.state.pulls.push(pull8);
    fixture.state.statuses.set("pr-8-a", {
      state: "pending",
      sha: "pr-8-a",
      total_count: 1,
    });
    assert.deepEqual(await checkSignals(), {
      observed: 1,
      started: 1,
      handled: 1,
      errors: 0,
    });

    pull8.state = "closed";
    pull8.closed_at = "2026-01-02T04:05:00.000Z";
    pull8.updated_at = new Date(Date.now() + 1000).toISOString();
    assert.deepEqual(await checkSignals(), {
      observed: 1,
      started: 1,
      handled: 1,
      errors: 0,
    });

    fixture.state.issueComments.push({
      id: 9002,
      body: "Please keep the error message actionable.",
      html_url: "https://github.com/acme/repo/issues/42#issuecomment-9002",
      created_at: "2026-01-02T04:06:00.000Z",
      updated_at: "2026-01-02T04:06:00.000Z",
      user: { login: "human" },
      issue_url: "https://api.github.com/repos/acme/repo/issues/42",
    });
    assert.deepEqual(await checkSignals(), {
      observed: 1,
      started: 1,
      handled: 1,
      errors: 0,
    });
    fixture.state.issueComments.length = 0;

    const signalAgents = await until(
      () =>
        f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        }),
      (result) => result.entries.length === 10,
    );
    const signalKeys = signalAgents.entries.map(
      (entry) => entry.agent.labels["paseo-nstack-signal"],
    );
    for (const prefix of [
      "pr-opened:7:",
      "ci-status:default:",
      "comment:9001",
      "pr-updated:7:",
      "ci-status:pr:7:",
      "pr-merged:7:",
      "pr-opened:8:",
      "pr-closed:8:",
      "comment:9002",
    ])
      assert.ok(
        signalKeys.some((key) => key?.startsWith(prefix)),
        prefix,
      );

    fixture.state.repositoryFailure = true;
    assert.deepEqual(await checkSignals(), {
      observed: 0,
      started: 0,
      handled: 0,
      errors: 1,
    });
    const failedPanel = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(failedPanel.status, "error");
    assert.match(failedPanel.health.message, /fixture unavailable/);
    assert.doesNotMatch(JSON.stringify(failedPanel), /e2e-token/);
    fixture.state.repositoryFailure = false;
    assert.deepEqual(await checkSignals(), {
      observed: 0,
      started: 0,
      handled: 1,
      errors: 0,
    });
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    const persistedWorkspace = persisted.workspaces.find(
      (workspace) => workspace.workspaceId === seed.workspaceId,
    );
    assert.ok(persistedWorkspace);
    persistedWorkspace.nextRepairAt = "2020-01-01T00:00:00.000Z";
    await writeFile(statePath, JSON.stringify(persisted));
    assert.equal(
      (await f.client.reloadPlugin("paseo-nstack")).status,
      "running",
    );
    const repair = await checkSignals();
    assert.equal(repair.errors, 0);
    const repairedAgents = await until(
      () =>
        f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        }),
      (result) => result.entries.length === 11,
    );
    assert.ok(
      repairedAgents.entries.some((entry) =>
        entry.agent.labels["paseo-nstack-signal"]?.startsWith("repair:"),
      ),
    );

    await f.restart();
    const restored = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(restored.counts.ready, 1);
    const afterRestart = await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    assert.deepEqual(afterRestart, {
      observed: 0,
      started: 0,
      handled: 1,
      errors: 0,
    });

    const secondProject = await f.project("nstack second project", "nstack-2");
    const secondSeed = await f.createAgent(
      secondProject,
      "second nstack workspace",
    );
    await f.rpc("paseo-nstack", "nstack.settings.save", {
      workspaceId: secondSeed.workspaceId,
      defaults,
      binding: { workspaceId: secondSeed.workspaceId, ...binding },
    });
    const secondWorkspace = await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: secondSeed.workspaceId,
    });
    assert.deepEqual(secondWorkspace, {
      observed: 1,
      started: 1,
      handled: 0,
      errors: 0,
    });
    const workspaceAgents = await until(
      () =>
        f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        }),
      (result) => result.entries.length === 12,
    );
    const workspaceIds = workspaceAgents.entries.map(
      (entry) => entry.agent.workspaceId,
    );
    assert.equal(
      workspaceIds.filter((workspaceId) => workspaceId === seed.workspaceId)
        .length,
      11,
    );
    assert.equal(
      workspaceIds.filter(
        (workspaceId) => workspaceId === secondSeed.workspaceId,
      ).length,
      1,
    );
    const globallyPaused = await f.rpc("paseo-nstack", "nstack.pause.set", {
      scope: "all",
      workspaceId: seed.workspaceId,
      paused: true,
    });
    assert.equal(globallyPaused.status, "paused");
    assert.equal(globallyPaused.defaults.automaticStarts, false);
    const globallyResumed = await f.rpc("paseo-nstack", "nstack.pause.set", {
      scope: "all",
      workspaceId: seed.workspaceId,
      paused: false,
    });
    assert.equal(globallyResumed.status, "watching");
    assert.equal(globallyResumed.defaults.automaticStarts, true);

    const page = await f.openBrowser();
    await page.goto(f.url);
    await page.getByText("nstack project", { exact: true }).last().click();
    await page.goto(
      page
        .url()
        .replace(/\/workspace\/[^/?]+/, `/workspace/${seed.workspaceId}`),
    );
    await page.keyboard.press("Control+K");
    await page.getByText("Automatic agents", { exact: true }).last().click();
    await expect(page.getByText("acme/repo", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Agent started: Issue #42 is Ready", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Owner", exact: true })
      .fill("acme");
    await page
      .getByRole("textbox", { name: "Repository", exact: true })
      .fill("repo");
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(
      page.getByText("Connected as human", { exact: true }).last(),
    ).toBeVisible();
    await mkdir("test-results", { recursive: true });
    await page.setViewportSize({ width: 1280, height: 960 });
    await page
      .getByText("Automatic agent settings", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "test-results/nstack-issue-settings.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Owner", exact: true }),
    ).toBeHidden();
    assert.deepEqual(
      (
        await f.rpc("paseo-nstack", "nstack.panel", {
          workspaceId: seed.workspaceId,
        })
      ).binding.repository,
      { owner: "acme", name: "repo" },
    );
  },
);

test(
  "paseo-nstack recovers from transient and corrupt state loads",
  { timeout: 120000 },
  async (t) => {
    const fixture = await githubFixture(t);
    const f = await runtime(t, {
      env: {
        GH_TOKEN: "e2e-token",
        PASEO_NSTACK_GITHUB_HOST: "github.com",
        PASEO_NSTACK_GITHUB_REST_URL: fixture.baseUrl,
      },
      tools: ["devenv", "opencode", "gh"],
    });
    const project = await f.project("nstack state recovery", "nstack-state");
    const seed = await f.createAgent(project, "nstack state workspace");
    await f.install("paseo-nstack");
    await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });

    const stateDirectory = join(f.home, "plugin-data", "paseo-nstack");
    const statePath = join(stateDirectory, "state.json");
    await f.client.reloadPlugin("paseo-nstack");
    await mkdir(statePath);
    await assert.rejects(
      f.rpc("paseo-nstack", "nstack.panel", {
        workspaceId: seed.workspaceId,
      }),
    );
    await rm(statePath, { recursive: true });
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        defaults: { automaticStarts: true, agent: null },
        bindings: [],
        workspaces: [],
        pending: [],
        launches: [],
        activity: [],
      }),
    );
    const recovered = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(recovered.status, "unbound");

    await writeFile(statePath, "{");
    await f.client.reloadPlugin("paseo-nstack");
    const afterCorruption = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(afterCorruption.status, "error");
    assert.match(
      afterCorruption.health.message,
      /moved to state\.json\.corrupt-/,
    );
    assert.ok(
      (await readdir(stateDirectory)).some((name) =>
        name.startsWith("state.json.corrupt-"),
      ),
    );
  },
);

test(
  "paseo-nstack stops retrying permanent launch failures",
  { timeout: 120000 },
  async (t) => {
    const fixture = await githubFixture(t);
    const f = await runtime(t, {
      env: {
        GH_TOKEN: "e2e-token",
        PASEO_NSTACK_GITHUB_HOST: "github.com",
        PASEO_NSTACK_GITHUB_REST_URL: fixture.baseUrl,
      },
      tools: ["devenv", "opencode", "gh"],
    });
    const project = await f.project("nstack launch failures", "nstack-failure");
    const seed = await f.createAgent(project, "nstack failure workspace");
    await f.install("paseo-nstack");
    const initial = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    const provider = initial.providerOptions.find(
      (option) => option.provider === "opencode" && option.supportsWrite,
    );
    assert.ok(provider, JSON.stringify(initial.providerOptions));
    const defaults = {
      automaticStarts: true,
      agent: { provider: provider.provider, model: provider.model },
    };
    await f.rpc("paseo-nstack", "nstack.settings.save", {
      workspaceId: seed.workspaceId,
      defaults,
      binding: {
        workspaceId: seed.workspaceId,
        repository: { owner: "acme", name: "repo" },
        paused: true,
        checkEverySeconds: 86400,
        repairEverySeconds: null,
        agent: { provider: "missing-provider", model: null },
      },
    });
    const paused = await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(paused.started, 0);
    assert.equal(paused.errors, 0);
    const failed = await f.rpc("paseo-nstack", "nstack.pause.set", {
      scope: "workspace",
      workspaceId: seed.workspaceId,
      paused: false,
    });
    assert.equal(failed.status, "error");
    assert.match(failed.health.message, /missing-provider/);

    assert.deepEqual(
      await f.rpc("paseo-nstack", "nstack.check.now", {
        workspaceId: seed.workspaceId,
      }),
      { observed: 0, started: 0, handled: 1, errors: 0 },
    );
    const afterRetry = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(
      afterRetry.activity.filter((entry) => entry.kind === "error").length,
      1,
    );
    assert.equal(
      (
        await f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        })
      ).entries.length,
      0,
    );
    assert.ok(afterRetry.binding);
    await f.rpc("paseo-nstack", "nstack.settings.save", {
      workspaceId: seed.workspaceId,
      defaults,
      binding: { ...afterRetry.binding, agent: null },
    });
    const recoveredAgents = await until(
      () =>
        f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        }),
      (result) => result.entries.length === 1,
    );
    assert.equal(
      recoveredAgents.entries[0].agent.labels["paseo-nstack-signal"],
      "ready:42:4201",
    );
    const retryStatePath = join(
      f.home,
      "plugin-data",
      "paseo-nstack",
      "state.json",
    );
    const retryState = await until(
      async () => JSON.parse(await readFile(retryStatePath, "utf8")),
      (database) =>
        database.launches.some(
          (launch) =>
            launch.agentId === recoveredAgents.entries[0].agent.id &&
            launch.state === "started",
        ),
    );
    const retriedLaunch = retryState.launches.find(
      (launch) => launch.agentId === recoveredAgents.entries[0].agent.id,
    );
    assert.ok(retriedLaunch);
    retriedLaunch.state = "failed";
    retriedLaunch.error = "Temporary launch failure";
    retriedLaunch.attempts = 1;
    retriedLaunch.retryAt = "2100-01-01T00:00:00.000Z";
    await writeFile(retryStatePath, JSON.stringify(retryState));
    await f.client.reloadPlugin("paseo-nstack");
    assert.deepEqual(
      await f.rpc("paseo-nstack", "nstack.check.now", {
        workspaceId: seed.workspaceId,
      }),
      { observed: 0, started: 0, handled: 1, errors: 0 },
    );
    const deferredState = JSON.parse(await readFile(retryStatePath, "utf8"));
    const deferredLaunch = deferredState.launches.find(
      (launch) => launch.agentId === retriedLaunch.agentId,
    );
    assert.equal(deferredLaunch.state, "failed");
    deferredLaunch.attempts = 5;
    deferredLaunch.retryAt = "2020-01-01T00:00:00.000Z";
    await writeFile(retryStatePath, JSON.stringify(deferredState));
    await f.client.reloadPlugin("paseo-nstack");
    await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    const cappedState = JSON.parse(await readFile(retryStatePath, "utf8"));
    assert.equal(
      cappedState.launches.find(
        (launch) => launch.agentId === retriedLaunch.agentId,
      ).state,
      "blocked",
    );
  },
);

test(
  "paseo-nstack paginates issues and closed pull transitions",
  { timeout: 120000 },
  async (t) => {
    const fixture = await githubFixture(t);
    fixture.state.issues.unshift(
      ...Array.from({ length: 100 }, (_, index) => ({
        number: index + 1000,
        title: `Backlog ${index}`,
        html_url: `https://github.com/acme/repo/issues/${index + 1000}`,
        state: "open",
        labels: [{ name: "stack:backlog" }],
      })),
    );
    const history = fixture.state.issueEvents.get(42);
    assert.ok(history);
    history.unshift(
      ...Array.from({ length: 100 }, (_, index) => ({
        id: index + 4000,
        event: "renamed",
        created_at: "2026-01-01T00:00:00.000Z",
      })),
    );
    const f = await runtime(t, {
      env: {
        GH_TOKEN: "e2e-token",
        PASEO_NSTACK_GITHUB_HOST: "github.com",
        PASEO_NSTACK_GITHUB_REST_URL: fixture.baseUrl,
      },
      tools: ["devenv", "opencode", "gh"],
    });
    const project = await f.project("nstack pagination", "nstack-pagination");
    const seed = await f.createAgent(project, "nstack pagination workspace");
    await f.install("paseo-nstack");

    const initial = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    const provider = initial.providerOptions.find(
      (option) => option.provider === "opencode" && option.supportsWrite,
    );
    assert.ok(provider, JSON.stringify(initial.providerOptions));
    const defaults = {
      automaticStarts: true,
      agent: { provider: provider.provider, model: provider.model },
    };
    await f.rpc("paseo-nstack", "nstack.settings.save", {
      workspaceId: seed.workspaceId,
      defaults,
      binding: {
        workspaceId: seed.workspaceId,
        repository: { owner: "acme", name: "repo" },
        paused: true,
        checkEverySeconds: 86400,
        repairEverySeconds: null,
        agent: null,
      },
    });
    await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    const synced = await f.rpc("paseo-nstack", "nstack.panel", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(synced.counts.ready, 1);

    const statePath = join(f.home, "plugin-data", "paseo-nstack", "state.json");
    const persisted = JSON.parse(await readFile(statePath, "utf8"));
    const workspace = persisted.workspaces.find(
      (candidate) => candidate.workspaceId === seed.workspaceId,
    );
    assert.ok(workspace);
    workspace.nextRepairAt = "2020-01-01T00:00:00.000Z";
    workspace.cursors["pulls:closed-since"] = "2026-01-02T04:00:00.000Z";
    for (let index = 1; index <= 101; index += 1) {
      const sha = `closed-${index.toString()}`;
      fixture.state.pulls.push({
        number: index,
        title: `Closed ${index.toString()}`,
        html_url: `https://github.com/acme/repo/pull/${index.toString()}`,
        state: "closed",
        created_at: "2026-01-02T04:00:00.000Z",
        updated_at: "2026-01-02T05:00:00.000Z",
        closed_at: "2026-01-02T05:00:00.000Z",
        merged_at: null,
        head: { sha },
      });
      workspace.cursors[`pull:${index.toString()}`] = `open|${sha}||`;
    }
    await writeFile(statePath, JSON.stringify(persisted));
    await f.client.reloadPlugin("paseo-nstack");
    const closed = await f.rpc("paseo-nstack", "nstack.check.now", {
      workspaceId: seed.workspaceId,
    });
    assert.equal(closed.observed, 101);
    assert.equal(closed.started, 0);
    assert.equal(closed.errors, 0);
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(
      after.pending.filter(
        (signal) =>
          signal.workspaceId === seed.workspaceId &&
          signal.kind === "pr_closed",
      ).length,
      101,
    );
    assert.equal(
      after.pending.some(
        (signal) =>
          signal.workspaceId === seed.workspaceId && signal.kind === "repair",
      ),
      false,
    );
  },
);

test(
  "paseo-nstack uses exclusive issue labels and discards stale Ready work",
  { timeout: 120000 },
  async (t) => {
    const fixture = await githubFixture(t);
    const ready = fixture.state.issues[0];
    const events = fixture.state.issueEvents.get(42);
    assert.ok(ready);
    assert.ok(events);
    const states = [
      ["stack:in-progress"],
      ["stack:in-review"],
      ["stack:merge-queue"],
      ["stack:hitl"],
      ["stack:ready", "stack:done"],
      ["stack:done"],
      ["stack:backlog"],
      ["bug"],
    ];
    fixture.state.issues.push(
      ...states.map((labels, index) => ({
        number: index + 43,
        title: `Work ${index + 43}`,
        html_url: `https://github.com/acme/repo/issues/${index + 43}`,
        state: "open",
        labels: labels.map((name) => ({ name })),
      })),
      {
        ...ready,
        number: 51,
        state: "closed",
      },
      {
        ...ready,
        number: 52,
        pull_request: {
          url: "https://api.github.com/repos/acme/repo/pulls/52",
        },
      },
    );
    const f = await runtime(t, {
      env: {
        GH_TOKEN: "e2e-token",
        PASEO_NSTACK_GITHUB_HOST: "github.com",
        PASEO_NSTACK_GITHUB_REST_URL: fixture.baseUrl,
      },
      tools: ["devenv", "opencode", "gh"],
    });
    const project = await f.project("nstack labels", "nstack-labels");
    const seed = await f.createAgent(project, "nstack labels workspace");
    await f.install("paseo-nstack");
    const input = { workspaceId: seed.workspaceId };
    const panel = () => f.rpc("paseo-nstack", "nstack.panel", input);
    const check = () => f.rpc("paseo-nstack", "nstack.check.now", input);
    const agents = async () =>
      (
        await f.client.fetchAgents({
          filter: {
            labels: { "paseo-nstack": "orchestrator" },
            includeArchived: true,
          },
        })
      ).entries;
    const initial = await panel();
    const provider = initial.providerOptions.find(
      (option) => option.provider === "opencode" && option.supportsWrite,
    );
    assert.ok(provider);
    await f.rpc("paseo-nstack", "nstack.settings.save", {
      ...input,
      defaults: {
        automaticStarts: true,
        agent: { provider: provider.provider, model: provider.model },
      },
      binding: {
        ...input,
        repository: { owner: "acme", name: "repo" },
        paused: true,
        checkEverySeconds: 86400,
        repairEverySeconds: null,
        agent: null,
      },
    });
    assert.deepEqual(await check(), {
      observed: 1,
      started: 0,
      handled: 0,
      errors: 0,
    });
    const counts = await panel();
    assert.deepEqual(counts.counts, {
      ready: 1,
      building: 1,
      reviewing: 1,
      mergeQueue: 1,
      needsYou: 2,
    });
    assert.equal(
      counts.attention.find((issue) => issue.number === 47)?.status,
      "needs_you",
    );
    assert.equal(
      counts.attention.find((issue) => issue.number === 45)?.url,
      "https://github.com/acme/repo/issues/45",
    );

    ready.title = "Updated title";
    ready.body = "Updated details";
    ready.updated_at = "2026-01-02T04:00:00.000Z";
    ready.labels.push({ name: "bug" });
    events.push({
      id: 4202,
      event: "labeled",
      label: { name: "bug" },
      created_at: ready.updated_at,
    });
    assert.deepEqual(await check(), {
      observed: 0,
      started: 0,
      handled: 1,
      errors: 0,
    });
    events.push(
      {
        id: 4203,
        event: "unlabeled",
        label: { name: "stack:ready" },
        created_at: "2026-01-02T04:01:00.000Z",
      },
      {
        id: 4204,
        event: "labeled",
        label: { name: "stack:ready" },
        created_at: "2026-01-02T04:02:00.000Z",
      },
    );
    assert.deepEqual(await check(), {
      observed: 1,
      started: 0,
      handled: 0,
      errors: 0,
    });

    ready.labels.push({ name: "stack:hitl" });
    const resumed = await f.rpc("paseo-nstack", "nstack.pause.set", {
      ...input,
      scope: "workspace",
      paused: false,
    });
    assert.equal(resumed.counts.ready, 0);
    assert.equal(resumed.counts.needsYou, 3);
    assert.equal((await agents()).length, 0);
    ready.labels = [{ name: "stack:ready" }, { name: "bug" }];
    assert.deepEqual(await check(), {
      observed: 1,
      started: 1,
      handled: 0,
      errors: 0,
    });
    assert.equal(
      (await agents())[0].agent.labels["paseo-nstack-signal"],
      "ready:42:4204",
    );
    assert.deepEqual(await check(), {
      observed: 0,
      started: 0,
      handled: 1,
      errors: 0,
    });
    ready.state = "closed";
    assert.deepEqual(await check(), {
      observed: 0,
      started: 0,
      handled: 0,
      errors: 0,
    });
    assert.equal((await panel()).counts.ready, 0);
    assert.equal((await agents()).length, 1);
  },
);
