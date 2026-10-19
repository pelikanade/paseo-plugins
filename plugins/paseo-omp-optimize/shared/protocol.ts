import { z } from "zod";

export const TIMELINE_KIND = "read-image";
export const TIMELINE_VERSION = 1;
export const INTENT_KIND = "omp-intent";
export const INTENT_VERSION = 1;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_INTENT_LENGTH = 16384;

export const imageMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

export type ImageMimeType = z.infer<typeof imageMimeTypeSchema>;

export const readImageItemSchema = z
  .object({
    filePath: z.string().min(1).max(4096),
    content: z.string().max(16384),
    width: z.number().int().positive().max(100000).optional(),
    height: z.number().int().positive().max(100000).optional(),
  })
  .strict();

export type ReadImageItem = z.infer<typeof readImageItemSchema>;

export const intentItemSchema = z
  .object({
    callId: z.string().min(1).max(1024),
    intent: z.string().min(1).max(MAX_INTENT_LENGTH),
  })
  .strict();

export type IntentItem = z.infer<typeof intentItemSchema>;

export const imageReadMarker =
  /^Read image file \[(?<declaredMimeType>image\/[a-z0-9.+-]+)\]/i;
export const originalDimensions =
  /\[Image: original (?<width>\d+)x(?<height>\d+)/;
