import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const settingsSchema = z.object({
  devenvBin: z.string().trim().min(1).default("devenv"),
  loadTimeoutMs: z.number().int().positive().default(120000),
  failureRetryMs: z.number().int().nonnegative().default(60000),
  runtimeDir: z.string().default(""),
  maxRoots: z.number().int().positive().default(8),
  maxCaptureBytes: z.number().int().positive().default(8388608),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsDefinition = defineSettings({
  id: "devenv",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});
export const statusSchema = z.object({
  root: z.string().nullable(),
  status: z
    .enum(["denied", "detected", "loading", "ready", "error"])
    .nullable(),
  applied: z.boolean(),
  needsReload: z.boolean(),
  error: z.string().nullable(),
});
export type StatusView = z.infer<typeof statusSchema>;
const target = z.object({ agentId: z.string().min(1) }).strict();
export const statusRpc = defineRpc({
  name: "devenv.status",
  input: target,
  output: statusSchema,
});
export const allowRpc = defineRpc({
  name: "devenv.allow",
  input: target,
  output: statusSchema,
});
export const loadRpc = defineRpc({
  name: "devenv.load",
  input: target,
  output: statusSchema,
});

export function statusLabel(view: StatusView): string {
  if (view.needsReload) return "devenv · reload required";
  if (view.applied) return "devenv · applied";
  switch (view.status) {
    case "denied":
      return "devenv · untrusted";
    case "detected":
      return "devenv · detected";
    case "loading":
      return "devenv · loading";
    case "ready":
      return "devenv · prepared";
    case "error":
      return "devenv · error";
    case null:
      return "devenv";
  }
}
