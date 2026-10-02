import assert from "node:assert/strict";
import test from "node:test";
import {
  access,
  cp,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect } from "@playwright/test";
import {
  command,
  nix,
  root,
  runtime,
  until,
  providerEnvironments,
} from "./support/runtime.mjs";

test(
  "plugins run on a real isolated Paseo daemon",
  { timeout: 600000 },
  async (t) => {
    const f = await runtime(t);
    await f.test(
      "Greeting RPC validates requests across the daemon transport and survives reload",
      async () => {
        await f.install("hello-paseo");
        assert.deepEqual(
          await f.rpc("hello-paseo", "greeting.create", { name: "E2E" }),
          { message: "Hello, E2E!" },
        );
        await assert.rejects(
          f.rpc("hello-paseo", "greeting.create", { name: 7 }),
        );
        assert.equal(
          (await f.client.reloadPlugin("hello-paseo")).status,
          "running",
        );
        assert.deepEqual(
          await f.rpc("hello-paseo", "greeting.create", { name: "Reloaded" }),
          { message: "Hello, Reloaded!" },
        );
        assert.equal(
          (await f.client.disablePlugin("hello-paseo")).status,
          "disabled",
        );
        await assert.rejects(
          f.rpc("hello-paseo", "greeting.create", { name: "Disabled" }),
        );
        assert.equal(
          (await f.client.enablePlugin("hello-paseo")).status,
          "running",
        );
        assert.deepEqual(
          await f.rpc("hello-paseo", "greeting.create", { name: "Enabled" }),
          { message: "Hello, Enabled!" },
        );
      },
    );
    await f.install("devenv");
    const project = await f.project("project with spaces");
    let agent;
    let page;
    await f.test(
      "untrusted projects are reported without evaluating Nix",
      async () => {
        agent = await f.createAgent(project, "Trust E2E");
        assert.deepEqual(await f.status(agent), {
          root: project,
          status: "denied",
          applied: false,
          needsReload: false,
          autoReload: false,
          error: null,
        });
        const processes = await until(
          () => providerEnvironments(f.temporary),
          (values) => values.some((value) => value.status === "denied"),
        );
        assert.equal(
          processes.find((value) => value.status === "denied").value,
          undefined,
        );
        for (let index = 0; index < 3; index++)
          assert.equal((await f.status(agent)).status, "denied");
        await assert.rejects(access(join(project, ".devenv")), {
          code: "ENOENT",
        });
        await assert.rejects(
          f.rpc("devenv", "devenv.status", { agentId: agent.id, extra: true }),
        );
        await assert.rejects(
          f.rpc("devenv", "devenv.status", { agentId: "missing-agent" }),
          /Agent not found: missing-agent/,
        );
      },
    );
    await f.test(
      "Paseo Web UI calls Greeting and grants trust, prepares Nix and reloads the real provider",
      async () => {
        page = await f.openBrowser();
        await page.goto(f.url);
        await page.getByText("Greeting", { exact: true }).click();
        await expect(
          page.getByText("Ask the daemon for a greeting.", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Create greeting", exact: true })
          .click();
        await expect(
          page.getByText("Hello, Paseo!", { exact: true }),
        ).toBeVisible();
        await page
          .getByText("project with spaces", { exact: true })
          .last()
          .click();
        await page.getByText("Trust E2E", { exact: true }).last().click();
        await expect(
          page.getByText("devenv · untrusted", { exact: true }),
        ).toBeVisible();
        await page.getByText("devenv · untrusted", { exact: true }).click();
        await expect(
          page.getByText("Project not trusted", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Review project trust", exact: true })
          .click();
        await expect(
          page.getByText("Allow this project to run code?", { exact: true }),
        ).toBeVisible();
        assert.equal((await f.status(agent)).status, "denied");
        await page
          .getByRole("button", { name: "Allow project", exact: true })
          .click();
        const applied = await until(
          () => f.status(agent),
          (view) => {
            assert.notEqual(view.status, "error", view.error);
            assert.equal(view.error, null);
            return view.applied && !view.autoReload;
          },
          240000,
        );
        assert.equal(applied.status, "ready", JSON.stringify(applied));
        assert.equal(applied.needsReload, false);
        const processes = await until(
          () => providerEnvironments(f.temporary),
          (values) => values.some((value) => value.value === "initial"),
        );
        const injected = processes.find((value) => value.value === "initial");
        assert.equal(injected.root, project);
        assert.equal(injected.status, "ready");
        assert.equal(injected.filtered, undefined);
        await expect(
          page.getByText("Environment applied", { exact: true }),
        ).toBeVisible({ timeout: 15000 });
      },
    );
    await f.test(
      "configuration changes prepare in the background and apply only after a real agent reload",
      async () => {
        await writeFile(join(project, "devenv.nix"), nix("changed"));
        const stale = await f.status(agent);
        assert.equal(stale.applied, true);
        assert.equal(stale.needsReload, true);
        await f.rpc("devenv", "devenv.load", { agentId: agent.id });
        const prepared = await until(
          () => f.status(agent),
          (view) => {
            assert.equal(view.error, null);
            return view.status === "ready";
          },
          180000,
        );
        assert.equal(prepared.needsReload, true);
        assert.equal(prepared.applied, true);
        assert.equal(
          (await providerEnvironments(f.temporary)).some(
            (value) => value.value === "initial",
          ),
          true,
        );
        assert.equal(
          (await providerEnvironments(f.temporary)).some(
            (value) => value.value === "changed",
          ),
          false,
        );
        await f.cli(["agent", "reload", agent.id]);
        const applied = await f.status(agent);
        assert.equal(applied.needsReload, false);
        assert.equal(applied.applied, true);
        await until(
          () => providerEnvironments(f.temporary),
          (values) =>
            values.some(
              (value) => value.value === "changed" && value.root === project,
            ),
        );
      },
    );
    await f.test(
      "revocation preserves the running environment and blocks injection after reload",
      async () => {
        await writeFile(join(f.trust, "allowed"), "");
        const revoked = await f.status(agent);
        assert.equal(revoked.status, "denied");
        assert.equal(revoked.applied, true);
        assert.equal(revoked.needsReload, true);
        assert.equal(
          (await providerEnvironments(f.temporary)).some(
            (value) => value.value === "changed",
          ),
          true,
        );
        await f.cli(["agent", "reload", agent.id]);
        const host = await f.status(agent);
        assert.equal(host.status, "denied");
        assert.equal(host.applied, false);
        assert.equal(host.needsReload, false);
        const processes = await until(
          () => providerEnvironments(f.temporary),
          (values) =>
            values.some(
              (value) => value.status === "denied" && value.root === project,
            ),
        );
        assert.equal(
          processes.find(
            (value) => value.status === "denied" && value.root === project,
          ).value,
          undefined,
        );
      },
    );
    await f.test(
      "invalid Nix reports an error and recovers through preparation and agent reload",
      async () => {
        await writeFile(join(project, "devenv.nix"), "{ invalid nix syntax\n");
        await f.rpc("devenv", "devenv.allow", { agentId: agent.id });
        const broken = await until(
          () => f.status(agent),
          (view) => view.status === "error" && !view.autoReload,
          180000,
        );
        assert.equal(broken.applied, false);
        assert.match(broken.error, /syntax|unexpected/i);
        await expect(
          page.getByText("Environment failed", { exact: true }),
        ).toBeVisible({ timeout: 15000 });
        await expect(
          page.getByText(/unexpected.*syntax|syntax error/i),
        ).toBeVisible();
        await writeFile(join(project, "devenv.nix"), nix("recovered"));
        await f.rpc("devenv", "devenv.load", { agentId: agent.id });
        const prepared = await until(
          () => f.status(agent),
          (view) => {
            assert.equal(view.error, null);
            return view.status === "ready";
          },
          180000,
        );
        assert.equal(prepared.applied, false);
        assert.equal(prepared.needsReload, true);
        await f.cli(["agent", "reload", agent.id]);
        await until(
          () => providerEnvironments(f.temporary),
          (values) => values.some((value) => value.value === "recovered"),
        );
        assert.equal((await f.status(agent)).applied, true);
      },
    );
    await f.test(
      "Git worktrees inherit primary trust and inject their own canonical project root",
      async () => {
        const git = (args) =>
          command("git", args, { cwd: project, env: f.env });
        await git(["init", "-b", "main"]);
        await git([
          "-c",
          "user.name=E2E",
          "-c",
          "user.email=e2e@example.invalid",
          "add",
          "devenv.nix",
          "devenv.yaml",
          "devenv.lock",
        ]);
        await git([
          "-c",
          "user.name=E2E",
          "-c",
          "user.email=e2e@example.invalid",
          "commit",
          "-m",
          "E2E project",
        ]);
        const worktree = join(f.temporary, "linked worktree");
        await git(["worktree", "add", "-b", "e2e-worktree", worktree]);
        const linked = await f.createAgent(worktree, "Worktree E2E");
        const applied = await until(
          () => f.status(linked),
          (view) => {
            assert.equal(view.error, null);
            return view.status === "ready";
          },
          180000,
        );
        assert.equal(applied.root, worktree);
        await f.cli(["agent", "reload", linked.id]);
        assert.equal((await f.status(linked)).applied, true);
        await until(
          () => providerEnvironments(f.temporary),
          (values) =>
            values.some(
              (value) => value.root === worktree && value.value === "recovered",
            ),
        );
        assert.equal(
          (await readFile(join(f.trust, "allowed"), "utf8")).trim(),
          project,
        );
        await writeFile(join(f.trust, "allowed"), "");
        assert.equal((await f.status(linked)).status, "denied");
        assert.equal((await f.status(linked)).needsReload, true);
        await f.client.deleteAgent(linked.id);
      },
    );
    await f.test(
      "the scaffold command creates a standalone plugin that loads and answers RPC",
      async () => {
        const checkout = join(f.temporary, "scaffold");
        await mkdir(join(checkout, "scripts"), { recursive: true });
        await cp(
          join(root, "scripts/create-plugin.mjs"),
          join(checkout, "scripts/create-plugin.mjs"),
        );
        await command(
          process.execPath,
          [join(checkout, "scripts/create-plugin.mjs"), "e2e-generated"],
          { env: f.env },
        );
        const generated = join(checkout, "plugins/e2e-generated");
        const manifest = JSON.parse(
          await readFile(join(generated, "package.json"), "utf8"),
        );
        assert.equal(manifest.name, "@paseo-plugins/e2e-generated");
        await symlink(
          join(root, "plugins/hello-paseo/node_modules"),
          join(generated, "node_modules"),
        );
        await command(
          "tsc",
          ["--noEmit", "-p", join(generated, "tsconfig.json")],
          { env: f.env },
        );
        await f.install("e2e-generated", generated);
        assert.deepEqual(
          await f.rpc("e2e-generated", "greeting.create", { name: "Scaffold" }),
          { message: "Hello, Scaffold!" },
        );
        const original = await readFile(
          join(generated, "package.json"),
          "utf8",
        );
        await assert.rejects(
          command(
            process.execPath,
            [join(checkout, "scripts/create-plugin.mjs"), "e2e-generated"],
            { env: f.env },
          ),
          /directory must be empty/i,
        );
        assert.equal(
          await readFile(join(generated, "package.json"), "utf8"),
          original,
        );
        await f.client.removePlugin("e2e-generated");
      },
    );
    await f.test(
      "host settings validate input, detect concurrent edits and survive plugin reload",
      async () => {
        const current = await f.rpc("devenv", "settings.devenv.read", {});
        assert.equal(current.status, "ready");
        const invalid = await f.rpc("devenv", "settings.devenv.write", {
          revision: current.revision,
          values: { ...current.values, maxRoots: 0 },
        });
        assert.equal(invalid.status, "invalid");
        assert.match(invalid.error, /positive|>0/);
        assert.equal(
          (await f.rpc("devenv", "settings.devenv.read", {})).revision,
          current.revision,
        );
        const saved = await f.rpc("devenv", "settings.devenv.write", {
          revision: current.revision,
          values: { ...current.values, maxRoots: 2 },
        });
        assert.equal(saved.status, "saved");
        const conflict = await f.rpc("devenv", "settings.devenv.write", {
          revision: current.revision,
          values: current.values,
        });
        assert.equal(conflict.status, "conflict");
        assert.equal((await f.client.reloadPlugin("devenv")).status, "running");
        const restored = await f.rpc("devenv", "settings.devenv.read", {});
        assert.equal(restored.status, "ready");
        assert.deepEqual(restored.values, saved.values);
        assert.equal(restored.values.maxRoots, 2);
      },
    );
  },
);
