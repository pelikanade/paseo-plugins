import { z } from "zod";

export const HANDOFF_TTL_MS = 15 * 60 * 1000;
export const HANDOFF_ROOT_NAME = "secret-request";
export const MAX_VALUE_LENGTH = 65536;
export const TIMELINE_KIND = "secret-request";
export const TIMELINE_VERSION = 1;
export const SESSION_ENV_KEY = "PASEO_SECRET_REQUEST_TOKEN";
export const MCP_SERVER_NAME = "secret-request";

export const secretRequestStatusSchema = z.enum([
  "pending",
  "delivered",
  "canceled",
]);

export const secretRequestSchema = z
  .object({
    requestId: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    hint: z.string().max(2000).optional(),
    expectedLength: z
      .number()
      .int()
      .positive()
      .max(MAX_VALUE_LENGTH)
      .optional(),
    status: secretRequestStatusSchema,
    createdAt: z.string(),
  })
  .strict();

export type SecretRequest = z.infer<typeof secretRequestSchema>;

export const resolvedStatusSchema = z.enum([
  "pending",
  "delivered",
  "canceled",
  "gone",
  "unavailable",
]);

export type ResolvedStatus = z.infer<typeof resolvedStatusSchema>;

export const requestInputSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(2000).optional(),
    hint: z.string().trim().min(1).max(2000).optional(),
    expectedLength: z
      .number()
      .int()
      .positive()
      .max(MAX_VALUE_LENGTH)
      .optional(),
  })
  .strict();

export type RequestInput = z.infer<typeof requestInputSchema>;

export const handoffResultSchema = z
  .object({
    status: resolvedStatusSchema,
    requestId: z.string(),
    label: z.string(),
    path: z.string().nullable(),
    handoffExpiresAt: z.string().nullable(),
    message: z.string().nullable(),
  })
  .strict();

export type HandoffResult = z.infer<typeof handoffResultSchema>;
