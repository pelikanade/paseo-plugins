import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const MIN_OB_VERSION = "0.0.14";
export const STALE_AFTER_SECONDS = 900;

export const settingsSchema = z.object({
  obPath: z.string().default(""),
  vaultId: z.string().nullable().default(null),
  vaultName: z.string().nullable().default(null),
});
export type Settings = z.infer<typeof settingsSchema>;

export const settingsDefinition = defineSettings({
  id: "obsidian",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});

export const syncStateSchema = z.enum([
  "unconfigured",
  "starting",
  "watching",
  "stale",
  "error",
]);
export type SyncState = z.infer<typeof syncStateSchema>;

export const syncErrorCodeSchema = z.enum([
  "ob_missing",
  "ob_too_old",
  "token_invalid",
  "vault_missing",
  "remote_unreachable",
  "lock_held",
  "sync_failed",
]);
export type SyncErrorCode = z.infer<typeof syncErrorCodeSchema>;

export const repairSchema = z.enum([
  "replace_token",
  "set_ob_path",
  "choose_vault",
  "retry",
]);
export type Repair = z.infer<typeof repairSchema>;

export function repairFor(code: SyncErrorCode): Repair {
  switch (code) {
    case "ob_missing":
    case "ob_too_old":
      return "set_ob_path";
    case "token_invalid":
      return "replace_token";
    case "vault_missing":
      return "choose_vault";
    case "remote_unreachable":
    case "lock_held":
    case "sync_failed":
      return "retry";
  }
}

export const injectionStatusSchema = z.enum([
  "injected",
  "not_injected",
  "truncated",
]);
export const injectionFileSchema = z.object({
  path: z.string(),
  status: injectionStatusSchema,
  bytes: z.number().nullable(),
  modifiedAt: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
});
export type InjectionFile = z.infer<typeof injectionFileSchema>;

export const syncConfigSchema = z.object({
  mode: z.enum(["bidirectional", "pull-only", "mirror-remote"]),
  configs: z.array(z.string()),
});

export const vaultStatusSchema = z.object({
  state: syncStateSchema,
  pulling: z.boolean(),
  error: z
    .object({
      code: syncErrorCodeSchema,
      repair: repairSchema,
      message: z.string().nullable(),
    })
    .nullable(),
  token: z.object({ stored: z.boolean(), account: z.string().nullable() }),
  ob: z.object({
    path: z.string().nullable(),
    source: z.enum(["override", "path"]).nullable(),
    version: z.string().nullable(),
    minVersion: z.string(),
  }),
  vault: z.object({ id: z.string(), name: z.string() }).nullable(),
  sync: syncConfigSchema.nullable(),
  lastSuccessAt: z.string().nullable(),
  staleAfterSeconds: z.number(),
  injection: z.object({ skills: z.array(injectionFileSchema) }),
});
export type VaultStatus = z.infer<typeof vaultStatusSchema>;

export const remoteVaultSchema = z.object({ id: z.string(), name: z.string() });

export const statusRpc = defineRpc({
  name: "obsidian.status",
  input: z.object({}).strict(),
  output: vaultStatusSchema,
});

export const tokenSetRpc = defineRpc({
  name: "obsidian.token.set",
  input: z.object({ token: z.string().min(1) }).strict(),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("saved"), account: z.string().nullable() }),
    z.object({ status: z.literal("rejected") }),
    z.object({ status: z.literal("error"), code: syncErrorCodeSchema }),
  ]),
});

export const tokenClearRpc = defineRpc({
  name: "obsidian.token.clear",
  input: z.object({}).strict(),
  output: z.object({ status: z.literal("removed") }),
});

export const remotesRpc = defineRpc({
  name: "obsidian.remotes",
  input: z.object({}).strict(),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), vaults: z.array(remoteVaultSchema) }),
    z.object({ status: z.literal("token_missing") }),
    z.object({ status: z.literal("error"), code: syncErrorCodeSchema }),
  ]),
});

export const syncNowRpc = defineRpc({
  name: "obsidian.sync.now",
  input: z.object({}).strict(),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("started") }),
    z.object({ status: z.literal("already_pulling") }),
    z.object({ status: z.literal("unconfigured") }),
  ]),
});

export const searchItemSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  url: z.url(),
  text: z.string(),
  resourceType: z.literal("obsidian-note"),
});

export const searchRpc = defineRpc({
  name: "obsidian.vault.search",
  input: z.object({ query: z.string() }).strict(),
  output: z.object({ items: z.array(searchItemSchema) }),
});
