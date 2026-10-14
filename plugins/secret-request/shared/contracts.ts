import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { handoffResultSchema, resolvedStatusSchema } from "./protocol";

const agentIdSchema = z.string().min(1).max(200);
const requestIdSchema = z.string().min(1).max(100);

export const submitRpc = defineRpc({
  name: "secret-request.submit",
  input: z
    .object({
      agentId: agentIdSchema,
      requestId: requestIdSchema,
      value: z.string().min(1).max(65536),
    })
    .strict(),
  output: handoffResultSchema,
});

export const cancelRpc = defineRpc({
  name: "secret-request.cancel",
  input: z
    .object({ agentId: agentIdSchema, requestId: requestIdSchema })
    .strict(),
  output: z
    .object({
      status: resolvedStatusSchema,
      message: z.string().nullable(),
    })
    .strict(),
});

export const statusRpc = defineRpc({
  name: "secret-request.status",
  input: z
    .object({ agentId: agentIdSchema, requestId: requestIdSchema })
    .strict(),
  output: z
    .object({
      status: resolvedStatusSchema,
      handoffExpiresAt: z.string().nullable(),
    })
    .strict(),
});
