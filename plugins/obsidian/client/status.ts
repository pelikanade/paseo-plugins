import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import type { SyncErrorCode, VaultStatus } from "../shared/contracts";
import { statusRpc } from "../shared/contracts";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export const toneColors = {
  neutral: "foregroundMuted",
  accent: "accent",
  success: "statusSuccess",
  warning: "statusWarning",
  danger: "statusDanger",
} satisfies Record<Tone, keyof PluginTheme["colors"]>;

export function useVaultStatus() {
  const read = useRpc(statusRpc);
  return useQuery({
    queryKey: ["obsidian", "status"],
    queryFn: () => read({}),
    refetchInterval: (query) =>
      query.state.data?.state === "starting" ? 1500 : 5000,
  });
}

export function toneFor(state: VaultStatus["state"]): Tone {
  switch (state) {
    case "watching":
      return "success";
    case "stale":
      return "warning";
    case "error":
      return "danger";
    case "starting":
      return "accent";
    case "unconfigured":
      return "neutral";
  }
}

export function relativeTime(iso: string | null): string {
  if (iso === null) return copy.never;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return copy.never;
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  const date = new Date(at);
  return `${date.toLocaleString("en", { month: "short" })} ${String(date.getDate())}, ${date.toTimeString().slice(0, 5)}`;
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${String(bytes)} B`;
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${String(Math.round(kilobytes * 10) / 10)} KB`;
  return `${String(Math.round((kilobytes / 1024) * 10) / 10)} MB`;
}

export const copy = {
  never: "Never synced",
  title: "Obsidian vault",
  readOnly: "Read-only",
  tools: "list_vault, glob_vault, grep_vault, read_vault",
  lastSync: "Last sync",
  vault: "Vault",
  syncing: "Syncing…",
  state: {
    unconfigured: "Not set up",
    starting: "Starting sync",
    watching: "Up to date",
    stale: "Out of date",
    error: "Sync error",
  } satisfies Record<VaultStatus["state"], string>,
  offline: (label: string) =>
    `Host ${label} is offline. The state below was read before it disconnected.`,
  statusReadError: (label: string) =>
    `Could not read vault status from ${label}.`,
  staleBanner: (relative: string) =>
    `Out of date. Last successful sync ${relative}. Agents read the last copy.`,
  recovered: "Sync recovered. Up to date.",
  openSettings: "Open settings",
  unknown: "Unknown",
  skillsHeading: "Skills",
  skillColumns: {
    skill: "Skill",
    description: "Description",
    status: "Status",
    size: "Size",
  },
  status: {
    injected: "Injected",
    truncated: "Truncated",
    skipped: "Not injected",
  },
  skillsNone: "No skills in Skills/",
  sections: {
    connection: "Connection",
    cli: "Obsidian CLI (ob)",
    vault: "Vault",
    instructions: "Skills",
  },
  token: {
    label: "Sync token",
    stored: (account: string) => `Stored for ${account}`,
    storedNoAccount: "Token stored",
    none: "No token stored",
    placeholder: "Paste sync token",
  },
  addToken: "Set up vault",
  saveToken: "Save token",
  changeToken: "Change token",
  saving: "Saving…",
  removeToken: "Remove token",
  settingsLoading: "Loading settings…",
  cli: {
    label: "ob path",
    found: (path: string) => `Found: ${path}`,
    notFound: "Not found on PATH",
    placeholder: "Path or name of ob",
    save: "Save ob path",
    minimum: "minimum",
  },
  vaultSelect: {
    label: "Remote vault",
    none: "No vault selected",
    choose: "Choose vault",
    change: "Change vault",
    notFound: "Not found",
  },
  loadingVaults: "Loading vaults…",
  noRemoteVaults: "No remote vaults on this account.",
  syncNow: "Sync now",
  switchVault: "Switch vault",
  reset: "Reset settings",
  reload: "Reload",
  settingsReadError: (error: string) => `Settings could not be read: ${error}`,
  settingsInvalid: (error: string) => `Settings are invalid: ${error}`,
  settingsSaved: "Settings saved.",
  settingsSaveError: (error: string) => `Settings could not be saved: ${error}`,
  toasts: {
    tokenSaved: (account: string | null) =>
      account ? `Token saved for ${account}.` : "Token saved.",
    tokenRejected: "Token rejected. Nothing was saved.",
    tokenUnverified: (reason: string) => `${reason}. Nothing was saved.`,
    syncStarted: "Sync started.",
    syncBusy: "Sync is already running.",
    syncUnconfigured: "Add a token and choose a vault first.",
  },
  errors: {
    ob_missing: {
      title: "ob not found",
      body: "The Obsidian CLI (ob) is not on PATH. Install it, or set its path in settings.",
      action: "Set ob path",
    },
    ob_too_old: {
      title: "ob is too old",
      body: "Update ob to the minimum version, then retry.",
      action: "Retry sync",
    },
    token_invalid: {
      title: "Token rejected",
      body: "Obsidian rejected the sync token. It may be expired or revoked.",
      action: "Change token",
    },
    vault_missing: {
      title: "Vault not found",
      body: "The vault is not available to this token. It may have been deleted or moved.",
      action: "Choose vault",
    },
    remote_unreachable: {
      title: "Obsidian Sync unreachable",
      body: "Could not reach Obsidian Sync. Retrying. The last copy stays readable.",
      action: "Retry sync",
    },
    lock_held: {
      title: "Vault is locked",
      body: "Another sync process holds the lock for this vault. Stop it, then retry.",
      action: "Retry sync",
    },
    sync_failed: {
      title: "Sync failed",
      body: "The last sync failed. Retry, or check the ob output.",
      action: "Retry sync",
    },
  } satisfies Record<
    SyncErrorCode,
    { title: string; body: string; action: string }
  >,
  confirm: {
    removeTitle: "Remove sync token?",
    removeBody: (vault: string) =>
      `Sync stops. The local copy of ${vault} is deleted. Agents lose vault tools and the attachment source until a token and a vault are set again.`,
    remove: "Remove token",
    switchTitle: "Switch vault?",
    switchBody: (oldName: string, newName: string) =>
      `The local copy of ${oldName} is replaced by ${newName}. Sync pulls ${newName} from the start.`,
    cancel: "Cancel",
  },
  aside: {
    title: "Obsidian note",
    searchPlaceholder: "Search notes by name or path",
  },
} as const;
