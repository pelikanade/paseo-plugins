import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import {
  TIMELINE_KIND,
  TIMELINE_VERSION,
  imageReadMarker,
  originalDimensions,
} from "../shared/protocol";

export const readImageTransformer: PluginTimelineTransformerContribution<"tool_call"> =
  {
    id: "read-image",
    query: { itemType: "tool_call" },
    transform({ item }) {
      if (item.status !== "completed" || item.detail.type !== "read") {
        return undefined;
      }
      const content = item.detail.content ?? "";
      if (!imageReadMarker.test(content)) {
        return undefined;
      }
      const dimensions = originalDimensions.exec(content);
      const width = dimensions?.groups?.width;
      const height = dimensions?.groups?.height;
      return {
        items: [
          {
            type: "plugin",
            kind: TIMELINE_KIND,
            version: TIMELINE_VERSION,
            data: {
              filePath: item.detail.filePath,
              content,
              ...(width && height
                ? { width: Number(width), height: Number(height) }
                : {}),
            },
          },
        ],
      };
    },
  };
