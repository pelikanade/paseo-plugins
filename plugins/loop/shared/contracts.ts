import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MAX_INTERVAL_SECONDS } from "./parse";

const reasonSchema = z.enum(["interval", "heartbeat", "watch"]);

export const statusSchema = z
  .object({
    state: z.enum(["armed", "stopped"]),
    purpose: z.string().nullable(),
    prompt: z.string().nullable(),
    mode: z.enum(["fixed", "dynamic"]).nullable(),
    everySeconds: z.number().int().nullable(),
    heartbeatSeconds: z.number().int().nullable(),
    watch: z.array(z.string()).nullable(),
    watcher: z.enum(["off", "running", "exited"]),
    watchPid: z.number().int().nullable(),
    nextDueAt: z.string().nullable(),
    pending: z.boolean(),
    lastWakeAt: z.string().nullable(),
    lastReason: reasonSchema.nullable(),
    error: z.string().nullable(),
  })
  .strict();
export type LoopStatus = z.infer<typeof statusSchema>;

export const armSchema = z
  .object({
    agentId: z.string().min(1),
    prompt: z.string().trim().min(1).max(4000),
    mode: z.enum(["fixed", "dynamic"]),
    everySeconds: z.number().int().min(1).max(MAX_INTERVAL_SECONDS).optional(),
    heartbeatSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_INTERVAL_SECONDS)
      .optional(),
    watch: z.array(z.string().trim().min(1).max(200)).min(1).max(8).optional(),
    purpose: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .optional(),
  })
  .strict();

const parseSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("usage") }).strict(),
  z.object({ type: z.literal("stop") }).strict(),
  z.object({ type: z.literal("invalid"), message: z.string() }).strict(),
  z
    .object({
      type: z.literal("fixed"),
      everySeconds: z.number().int(),
      prompt: z.string(),
      purpose: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("dynamic"),
      prompt: z.string(),
      purpose: z.string(),
    })
    .strict(),
]);

export const parseRpc = defineRpc({
  name: "loop.parse",
  input: z.object({ text: z.string().max(8000) }).strict(),
  output: parseSchema,
});
export const armRpc = defineRpc({
  name: "loop.arm",
  input: armSchema,
  output: statusSchema,
});
export const stopRpc = defineRpc({
  name: "loop.stop",
  input: z.object({ agentId: z.string().min(1) }).strict(),
  output: statusSchema,
});
export const statusRpc = defineRpc({
  name: "loop.status",
  input: z.object({ agentId: z.string().min(1) }).strict(),
  output: statusSchema,
});
export const guideRpc = defineRpc({
  name: "loop.guide",
  input: z.object({}).strict(),
  output: z.object({ text: z.string() }).strict(),
});
export const connectionRpc = defineRpc({
  name: "loop.connection",
  input: z.object({ agentId: z.string().min(1) }).strict(),
  output: z.object({ url: z.string(), token: z.string() }).strict(),
});
