import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const sampleSchema = z.object({
  sampledAt: z.number(),
  host: z.object({
    hostname: z.string(),
    platform: z.string(),
    arch: z.string(),
    release: z.string(),
    cores: z.number().int().positive(),
    uptimeSeconds: z.number().nonnegative(),
  }),
  cpu: z.object({
    usagePct: z.number().min(0).max(100),
    perCorePct: z.array(z.number().min(0).max(100)),
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative(),
    availableBytes: z.number().nonnegative(),
    usagePct: z.number().min(0).max(100),
  }),
  load: z.object({
    one: z.number().nonnegative(),
    five: z.number().nonnegative(),
    fifteen: z.number().nonnegative(),
    supported: z.boolean(),
  }),
  history: z.object({
    sampledAt: z.array(z.number()).max(60),
    cpu: z.array(z.number().min(0).max(100)).max(60),
    memory: z.array(z.number().min(0).max(100)).max(60),
    load: z.array(z.number().nonnegative()).max(60),
  }),
});

export type HostSample = z.infer<typeof sampleSchema>;

export const sampleRpc = defineRpc({
  name: "host-monitor.sample",
  input: z.object({}).strict(),
  output: sampleSchema,
});
