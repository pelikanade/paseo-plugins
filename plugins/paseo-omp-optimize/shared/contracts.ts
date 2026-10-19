import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { MAX_IMAGE_BYTES, imageMimeTypeSchema } from "./protocol";

export const syncIntentWatchersRpc = defineRpc({
  name: "paseo-omp-optimize.sync-intent-watchers",
  input: z.object({}).strict(),
  output: z.object({}).strict(),
});

export const readImageRpc = defineRpc({
  name: "paseo-omp-optimize.read-image",
  input: z
    .object({
      agentId: z.string().min(1),
      filePath: z.string().min(1).max(4096),
    })
    .strict(),
  output: z
    .object({
      base64: z.string().min(1),
      mimeType: imageMimeTypeSchema,
      byteLength: z.number().int().positive().max(MAX_IMAGE_BYTES),
      fileName: z.string().min(1),
    })
    .strict(),
});
