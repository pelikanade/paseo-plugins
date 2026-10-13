import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SecretRequestCard } from "./client/card";
import {
  TIMELINE_KIND,
  TIMELINE_VERSION,
  secretRequestSchema,
} from "./shared/protocol";

export default function contribute(client: PluginClientContext) {
  return client.addTimelineRenderer({
    kind: TIMELINE_KIND,
    version: TIMELINE_VERSION,
    schema: secretRequestSchema,
    Component: SecretRequestCard,
  });
}
