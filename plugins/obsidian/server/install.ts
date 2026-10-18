import type {
  PluginServerContext,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  MIN_OB_VERSION,
  STALE_AFTER_SECONDS,
  type Settings,
  type VaultStatus,
  remotesRpc,
  repairFor,
  searchRpc,
  settingsDefinition,
  settingsSchema,
  statusRpc,
  syncNowRpc,
  tokenClearRpc,
  tokenSetRpc,
} from "../shared/contracts";
import {
  clearToken,
  readToken,
  validateToken,
  writeToken,
} from "./credentials";
import { Gateway } from "./gateway";
import { INJECTION_INSTRUCTIONS, Injection } from "./injection";
import { SkillMirror } from "./mirror";
import {
  atLeast,
  classifyFailure,
  childEnv,
  parseConfig,
  parseRemotes,
  probeOb,
  resolveBinary,
  runOb,
} from "./ob";
import type { ObConfig, ObLocation, ObRun } from "./ob";
import { searchVault } from "./search";
import { vaultExists, vaultPath } from "./vault";
import { Watcher } from "./watcher";
import type { SyncFailure } from "./watcher";

interface VaultOptions {
  dataRoot?: string;
  defaultObBinary: string;
}

export function installVault(
  server: PluginServerContext,
  options: VaultOptions,
) {
  const dataRoot =
    options.dataRoot ?? join(homedir(), ".paseo", "plugin-data", "obsidian");
  const root = vaultPath(dataRoot);
  const configHome = join(dataRoot, "config");
  const tokenPath = join(dataRoot, "token");
  let settings: Settings = settingsSchema.parse({});
  let token: string | null = null;
  let account: string | null = null;
  let tokenError: SyncFailure | null = null;
  let setupError: SyncFailure | null = null;
  let sync: ObConfig | null = null;
  let configuredKey: string | null = null;
  let watcher: Watcher | null = null;
  let probe: { location: ObLocation | null; version: string | null } | null =
    null;
  let probeKey = "";
  let probeAt = 0;
  let applying: Promise<void> = Promise.resolve();

  const classify = (result: ObRun): SyncFailure => {
    if (result.failure !== null)
      return { code: "sync_failed", message: result.failure };
    return classifyFailure(`${result.stderr}\n${result.stdout}`, token);
  };

  const locate = async () => {
    const key = `${settings.obPath}|${options.defaultObBinary}`;
    if (
      !probe ||
      probeKey !== key ||
      (probe.location === null && Date.now() - probeAt > 5000)
    ) {
      const resolved = await resolveBinary(
        settings.obPath,
        options.defaultObBinary,
      );
      const version = resolved ? await probeOb(resolved.path) : null;
      probe = { location: version ? resolved : null, version };
      probeKey = key;
      probeAt = Date.now();
    }
    const current = probe;
    return {
      location: current.location,
      version: current.version,
      tooOld:
        current.version !== null && !atLeast(current.version, MIN_OB_VERSION),
    };
  };

  const injection = new Injection(root, () => {
    const snapshot = watcher?.snapshot();
    return `${INJECTION_INSTRUCTIONS}\n\nVault "${settings.vaultName ?? "not configured"}" sync mode: ${sync?.mode ?? "not configured"}; last successful sync: ${snapshot?.lastSuccessAt ?? "never"}.`;
  });
  const mirror = new SkillMirror({
    sourceRoot: root,
    skillsRoot: join(homedir(), ".agents", "skills"),
    manifestPath: join(dataRoot, "skills.json"),
  });
  const gateway = new Gateway(root, () => {
    const lastSyncedAt = watcher?.snapshot().lastSuccessAt ?? null;
    return {
      vault: { name: settings.vaultName },
      lastSyncedAt,
      stale:
        lastSyncedAt !== null &&
        Date.now() - Date.parse(lastSyncedAt) > STALE_AFTER_SECONDS * 1000,
    };
  });

  const apply = async (): Promise<void> => {
    const { location, tooOld } = await locate();
    const vault = settings.vaultId;
    if (!vault) {
      await watcher?.stop();
      watcher = null;
      sync = null;
      configuredKey = null;
      await mirror.clear().catch(console.error);
      return;
    }
    await mirror.reconcile().catch(console.error);
    if (!location || tooOld || !token) {
      await watcher?.stop();
      watcher = null;
      sync = null;
      configuredKey = null;
      return;
    }
    const key = `${vault}|${location.path}|${token}`;
    if (configuredKey === key && watcher) return;
    await watcher?.stop();
    watcher = null;
    sync = null;
    configuredKey = null;
    const env = childEnv(token, configHome);
    const setup = await runOb(
      location.path,
      ["sync-setup", "--vault", vault, "--path", root, "--json"],
      { env, timeoutMs: 120000 },
    );
    if (setup.code !== 0) {
      setupError = classify(setup);
      return;
    }
    setupError = null;
    const configured = await runOb(
      location.path,
      [
        "sync-config",
        "--mode",
        "pull-only",
        "--configs",
        "",
        "--path",
        root,
        "--json",
      ],
      { env, timeoutMs: 60000 },
    );
    sync = parseConfig(configured.stdout) ?? { mode: "pull-only", configs: [] };
    const active = new Watcher({
      binary: location.path,
      env,
      vaultPath: root,
      token,
      onSynced: () => {
        if (settings.vaultId === null) return;
        mirror.reconcile().catch(console.error);
      },
    });
    watcher = active;
    configuredKey = key;
    active.start();
  };

  const reconfigure = (): Promise<void> => {
    const run = () => apply().catch(console.error);
    applying = applying.then(run, run);
    return applying;
  };

  const registered = server.registerSettings(settingsDefinition);
  const configure = (state: PluginSettingsState<typeof settingsSchema>) => {
    if (state.status === "ready") settings = state.values;
    else console.warn(`obsidian settings invalid: ${state.error}`);
    return reconfigure();
  };
  const ready = (async () => {
    const state = await registered.read();
    if (state.status === "ready") settings = state.values;
    else console.warn(`obsidian settings invalid: ${state.error}`);
    token = await readToken(tokenPath);
    if (token) {
      const { location, tooOld } = await locate();
      if (location && !tooOld) {
        const validation = await validateToken(
          location.path,
          token,
          configHome,
        );
        if (validation.status === "saved") account = validation.account;
        else if (validation.status === "rejected")
          tokenError = { code: "token_invalid", message: null };
      }
    }
    await reconfigure();
  })().catch(console.error);
  const unsubscribe = registered.subscribe(configure);

  const deriveError = async (): Promise<SyncFailure | null> => {
    const { location, version, tooOld } = await locate();
    if (!token || !settings.vaultId) return null;
    if (!location) return { code: "ob_missing", message: null };
    if (tooOld) return { code: "ob_too_old", message: version };
    return tokenError ?? setupError ?? watcher?.snapshot().error ?? null;
  };

  const status = async (): Promise<VaultStatus> => {
    const { location, version } = await locate();
    const vault =
      settings.vaultId && settings.vaultName
        ? { id: settings.vaultId, name: settings.vaultName }
        : null;
    const snapshot = watcher?.snapshot();
    const error = await deriveError();
    const lastSuccessAt = snapshot?.lastSuccessAt ?? null;
    const stale =
      lastSuccessAt !== null &&
      Date.now() - Date.parse(lastSuccessAt) > STALE_AFTER_SECONDS * 1000;
    const state: VaultStatus["state"] =
      !token || !vault
        ? "unconfigured"
        : error
          ? "error"
          : lastSuccessAt === null
            ? "starting"
            : stale
              ? "stale"
              : "watching";
    const files = await injection.read();
    return {
      state,
      pulling: snapshot?.pulling ?? false,
      error: error
        ? {
            code: error.code,
            repair: repairFor(error.code),
            message: error.message,
          }
        : null,
      token: { stored: token !== null, account },
      ob: {
        path: location?.path ?? null,
        source: location?.source ?? null,
        version,
        minVersion: MIN_OB_VERSION,
      },
      vault,
      sync,
      lastSuccessAt,
      staleAfterSeconds: STALE_AFTER_SECONDS,
      injection: { skills: files.skills },
    };
  };

  server.handle(statusRpc, async () => {
    await ready;
    return status();
  });
  server.handle(tokenSetRpc, async ({ token: pasted }) => {
    await ready;
    const { location, tooOld } = await locate();
    if (!location)
      return { status: "error" as const, code: "ob_missing" as const };
    if (tooOld)
      return { status: "error" as const, code: "ob_too_old" as const };
    const validation = await validateToken(location.path, pasted, configHome);
    if (validation.status === "rejected")
      return { status: "rejected" as const };
    if (validation.status === "error")
      return { status: "error" as const, code: validation.code };
    await writeToken(tokenPath, pasted);
    token = pasted;
    account = validation.account;
    tokenError = null;
    setupError = null;
    await reconfigure();
    return { status: "saved" as const, account: validation.account };
  });
  server.handle(tokenClearRpc, async () => {
    await ready;
    await watcher?.stop();
    watcher = null;
    const { location } = await locate();
    if (location && settings.vaultId)
      await runOb(location.path, ["sync-unlink", "--path", root], {
        env: childEnv(token, configHome),
        timeoutMs: 60000,
      });
    await clearToken(tokenPath);
    token = null;
    account = null;
    tokenError = null;
    setupError = null;
    sync = null;
    configuredKey = null;
    injection.invalidate();
    await mirror.clear().catch(console.error);
    await rm(root, { recursive: true, force: true });
    return { status: "removed" as const };
  });
  server.handle(remotesRpc, async () => {
    await ready;
    if (!token) return { status: "token_missing" as const };
    const { location } = await locate();
    if (!location)
      return { status: "error" as const, code: "ob_missing" as const };
    const result = await runOb(location.path, ["sync-list-remote", "--json"], {
      env: childEnv(token, configHome),
      timeoutMs: 30000,
    });
    const vaults = result.code === 0 ? parseRemotes(result.stdout) : null;
    if (vaults) return { status: "ok" as const, vaults };
    return { status: "error" as const, code: classify(result).code };
  });
  server.handle(syncNowRpc, async () => {
    await ready;
    if (!token || !settings.vaultId) return { status: "unconfigured" as const };
    if (!watcher) await reconfigure();
    if (!watcher) return { status: "unconfigured" as const };
    if (watcher.snapshot().pulling)
      return { status: "already_pulling" as const };
    watcher.syncNow().catch(console.error);
    return { status: "started" as const };
  });
  server.handle(searchRpc, async ({ query }) => {
    await ready;
    if (!(await vaultExists(root))) return { items: [] };
    return { items: await searchVault(root, settings.vaultName, query) };
  });

  const cleanups = [
    server.before("agent.create", async ({ request }) => {
      await ready;
      if (request.config.internal) return request;
      const [files, connection] = await Promise.all([
        injection.read(),
        gateway.connection(),
        (settings.vaultId === null ? mirror.clear() : mirror.reconcile()).catch(
          console.error,
        ),
      ]);
      return {
        ...request,
        config: {
          ...request.config,
          systemPrompt: [request.config.systemPrompt, files.block]
            .filter(Boolean)
            .join("\n\n"),
          mcpServers: {
            ...request.config.mcpServers,
            obsidian: {
              type: "http",
              url: connection.url,
              headers: { Authorization: `Bearer ${connection.token}` },
            },
          },
        },
      };
    }),
  ];

  let shutdown: Promise<void> | undefined;
  return () => {
    shutdown ??= (async () => {
      for (const cleanup of cleanups) cleanup();
      await unsubscribe();
      await watcher?.stop();
      await mirror.clear().catch(console.error);
      await gateway.shutdown();
    })();
    return shutdown;
  };
}
