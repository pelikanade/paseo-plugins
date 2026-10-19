import type { PluginClientContext } from "@getpaseo/plugin/client";
import { IntentRow } from "./client/intent";
import { ReadImageRow } from "./client/read-image";
import { readImageTransformer } from "./client/transformer";
import { syncIntentWatchersRpc } from "./shared/contracts";
import {
  INTENT_KIND,
  INTENT_VERSION,
  TIMELINE_KIND,
  TIMELINE_VERSION,
  intentItemSchema,
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
    client.addTimelineRenderer({
      kind: INTENT_KIND,
      version: INTENT_VERSION,
      schema: intentItemSchema,
      Component: IntentRow,
    }),
  ];
  client.rpc(syncIntentWatchersRpc, {}).catch(() => undefined);
  return async () => {
    for (const cleanup of cleanups) {
      await cleanup();
    }
  };
}
