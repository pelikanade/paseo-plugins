import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, resolve } from "node:path";
import type {
  PluginHandlerContext,
  PluginServerContext,
} from "@getpaseo/plugin/server";
import { readImageRpc } from "../shared/contracts";
import type { ImageMimeType } from "../shared/protocol";
import { MAX_IMAGE_BYTES } from "../shared/protocol";

const IMAGE_MIME_BY_EXTENSION: Partial<Record<string, ImageMimeType>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function sniffImageMime(bytes: Uint8Array): ImageMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const signature = ascii(bytes, 0, 6);
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") {
      return "image/avif";
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  return null;
}

async function resolveImagePath(
  agentId: string,
  filePath: string,
  paseo: PluginHandlerContext["paseo"],
): Promise<string> {
  const expanded =
    filePath === "~"
      ? homedir()
      : filePath.startsWith("~/")
        ? resolve(homedir(), filePath.slice(2))
        : filePath;
  if (isAbsolute(expanded)) {
    return expanded;
  }
  const snapshot = await paseo.agents.ref(agentId).refresh();
  const cwd = snapshot?.agent.cwd;
  if (!cwd) {
    throw new Error(`Agent ${agentId} has no working directory`);
  }
  return resolve(cwd, expanded);
}

export default function contribute(server: PluginServerContext) {
  server.handle(readImageRpc, async (input, { paseo }) => {
    const filePath = await resolveImagePath(
      input.agentId,
      input.filePath,
      paseo,
    );
    let stats;
    try {
      stats = await stat(filePath);
    } catch {
      throw new Error(`Cannot open image file: ${input.filePath}`);
    }
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${input.filePath}`);
    }
    if (stats.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `Image is larger than ${String(MAX_IMAGE_BYTES / 1024 / 1024)} MiB`,
      );
    }
    const buffer = await readFile(filePath);
    const mimeType =
      sniffImageMime(buffer) ??
      IMAGE_MIME_BY_EXTENSION[extname(filePath).toLowerCase()];
    if (!mimeType) {
      throw new Error(
        `Unsupported image format: ${extname(filePath) || "unknown"}`,
      );
    }
    return {
      base64: buffer.toString("base64"),
      mimeType,
      byteLength: buffer.byteLength,
      fileName: basename(filePath),
    };
  });
  return async () => {};
}
