import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { command, ensureOb, runtime, until } from "../support/runtime.mjs";

const AUTH = process.env.OBSIDIAN_AUTH_TOKEN;
const VAULT = process.env.OBSIDIAN_E2E_VAULT;

if (!AUTH || !VAULT)
  throw new Error(
    "The obsidian live suite needs real Obsidian credentials: OBSIDIAN_AUTH_TOKEN (a throwaway account token) and OBSIDIAN_E2E_VAULT (a throwaway remote vault id or name that already holds at least one note). Run it with OBSIDIAN_AUTH_TOKEN=... OBSIDIAN_E2E_VAULT=... pnpm test:obsidian. It starts a real daemon, syncs pull-only and never pushes.",
  );

test(
  "obsidian pulls a real vault from Obsidian Sync in pull-only mode",
  { timeout: 1800000 },
  async (t) => {
    const obBin = await ensureOb(t);
    const f = await runtime(t, {
      tools: ["opencode"],
      env: { PATH: `${obBin}:${process.env.PATH}` },
    });
    await f.install("obsidian");
    const ob = obBin ? join(obBin, "ob") : "ob";
    const status = () => f.rpc("obsidian", "obsidian.status", {});
    const managed = join(f.home, "plugin-data", "obsidian", "vault");
    const tokenFile = join(f.home, "plugin-data", "obsidian", "token");
    const second = await mkdtemp(join(tmpdir(), "paseo-ob-second-"));
    const secondConfig = await mkdtemp(join(tmpdir(), "paseo-ob-config-"));
    t.after(async () => {
      await rm(second, { recursive: true, force: true });
      await rm(secondConfig, { recursive: true, force: true });
    });
    const env = {
      ...f.env,
      OBSIDIAN_AUTH_TOKEN: AUTH,
      XDG_CONFIG_HOME: secondConfig,
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
      "the pasted token is validated against the CLI and stored 0600",
      async () => {
        const saved = await f.rpc("obsidian", "obsidian.token.set", {
          token: AUTH,
        });
        assert.equal(saved.status, "saved", JSON.stringify(saved));
        const stored = await stat(tokenFile);
        assert.equal(stored.mode & 0o777, 0o600);
        const view = await until(
          status,
          (value) => value.token.stored && value.state !== "unconfigured",
        );
        assert.equal(view.state, "starting");
        assert.equal(
          (await f.rpc("obsidian", "obsidian.remotes", {})).status,
          "ok",
        );
      },
    );

    await f.test(
      "the selected vault syncs pull-only with config syncing off",
      async () => {
        const remotes = await f.rpc("obsidian", "obsidian.remotes", {});
        assert.equal(remotes.status, "ok");
        const selected = remotes.vaults.find(
          (vault) => vault.id === VAULT || vault.name === VAULT,
        );
        assert.ok(selected, JSON.stringify(remotes.vaults));
        await writeSettings({ vaultId: selected.id, vaultName: selected.name });
        const view = await until(
          status,
          (value) => value.lastSuccessAt !== null || value.error !== null,
          300000,
        );
        assert.equal(view.error, null, JSON.stringify(view.error));
        assert.deepEqual(view.sync, { mode: "pull-only", configs: [] });
        assert.equal(view.state, "watching");
        assert.deepEqual(view.vault, {
          id: selected.id,
          name: selected.name,
        });
        await mkdir(managed, { recursive: true });
        const notes = await readdir(managed, { recursive: true });
        assert.ok(notes.length > 0, "the remote vault brought notes");
      },
    );

    await f.test(
      "a local change is never uploaded while the watcher runs",
      async () => {
        const localName = `local-only-${process.pid}.md`;
        await writeFile(join(managed, localName), "# local only\n");
        await f.rpc("obsidian", "obsidian.sync.now", {});
        const before = (await status()).lastSuccessAt;
        await until(
          status,
          (value) => value.pulling === false && value.lastSuccessAt !== before,
          600000,
        );
        await command(
          ob,
          ["sync-setup", "--vault", VAULT, "--path", second, "--json"],
          { env, timeout: 300000 },
        );
        await command(
          ob,
          ["sync-config", "--mode", "pull-only", "--path", second],
          { env, timeout: 120000 },
        );
        await command(ob, ["sync", "--path", second], {
          env,
          timeout: 600000,
        });
        const remote = await readdir(second, { recursive: true });
        assert.ok(remote.length > 0, "the second client pulled the vault");
        assert.equal(
          remote.includes(localName),
          false,
          "pull-only must not upload the local note",
        );
      },
    );

    await f.test(
      "clearing the token stops sync and removes the local copy",
      async () => {
        assert.equal(
          (await f.rpc("obsidian", "obsidian.token.clear", {})).status,
          "removed",
        );
        const view = await until(
          status,
          (value) => value.token.stored === false,
        );
        assert.equal(view.state, "unconfigured");
        assert.equal(view.sync, null);
        assert.deepEqual(
          await readdir(managed).catch((error) => error.code),
          "ENOENT",
        );
        assert.deepEqual(
          await stat(tokenFile).catch((error) => error.code),
          "ENOENT",
        );
      },
    );
  },
);
