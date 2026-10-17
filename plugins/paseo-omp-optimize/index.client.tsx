import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReadImageRow } from "./client/read-image";
import { readImageTransformer } from "./client/transformer";
import {
  TIMELINE_KIND,
  TIMELINE_VERSION,
  readImageItemSchema,
} from "./shared/protocol";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addTimelineTransformer(readImageTransformer),
    client.addTimelineRenderer({
      kind: TIMELINE_KIND,
      version: TIMELINE_VERSION,
      schema: readImageItemSchema,
      Component: ReadImageRow,
    }),
  ];
  return async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  };
}
