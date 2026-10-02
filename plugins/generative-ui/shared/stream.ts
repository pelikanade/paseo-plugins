import {
  applyPatches,
  emptySpec,
  headerSchema,
  maxBytes,
  patchSchema,
  validateSpec,
} from "./protocol";
import type { UiSpec } from "./protocol";

export type Segment =
  | { type: "text"; text: string }
  | {
      type: "ui";
      cardId: string;
      spec: UiSpec;
      complete: boolean;
      error: string | null;
    };
export function parseMessage(text: string, complete: boolean): Segment[] {
  if (text.length > maxBytes * 2) return [{ type: "text", text }];
  const segments: Segment[] = [];
  const pattern = /^```paseo-ui\s*\r?\n/gm;
  let offset = 0;
  const ids = new Set<string>();
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > offset)
      segments.push({ type: "text", text: text.slice(offset, match.index) });
    const start = match.index + match[0].length;
    const tail = text.slice(start);
    const close = /^```\s*$/m.exec(tail);
    const body = close ? tail.slice(0, close.index) : tail;
    const lines = body.split("\n");
    if (!close && !complete) lines.pop();
    let cardId = `invalid-${String(match.index)}`;
    let spec = emptySpec();
    let error: string | null = null;
    try {
      const first = lines.shift();
      if (!first?.trim()) throw new Error("Waiting for UI header");
      cardId = headerSchema.parse(JSON.parse(first)).cardId;
      if (ids.has(cardId)) throw new Error("Duplicate inline card ID");
      ids.add(cardId);
      if (lines.length > 500) throw new Error("UI exceeds 500 patches");
      for (const line of lines) {
        if (!line.trim()) continue;
        spec = applyPatches(spec, [patchSchema.parse(JSON.parse(line))]);
      }
      if (close || complete) validateSpec(spec, true);
      if (complete && !close) throw new Error("UI fence is not closed");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Invalid UI";
    }
    segments.push({
      type: "ui",
      cardId,
      spec,
      complete: Boolean(close),
      error,
    });
    offset = close ? start + close.index + close[0].length : text.length;
    pattern.lastIndex = offset;
    if (!close) break;
  }
  if (offset < text.length)
    segments.push({ type: "text", text: text.slice(offset) });
  return segments;
}
