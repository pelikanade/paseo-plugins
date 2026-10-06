import type { PluginClientContext } from "@getpaseo/plugin/client";
import { fillerTextTransformer } from "./client/filler";

export default function contribute(client: PluginClientContext) {
  return client.addTimelineTransformer(fillerTextTransformer);
}
