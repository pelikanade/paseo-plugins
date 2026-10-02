import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";

export const inlineSchema = z
  .object({
    text: z.string().max(120000),
    phase: z.enum(["streaming", "complete"]),
  })
  .strict();
export const transformer: PluginTimelineTransformerContribution<"assistant_message"> =
  {
    id: "inline-ui",
    query: { itemType: "assistant_message" },
    transform({ item, phase }) {
      if (!/^```paseo-ui\s*\r?\n/m.test(item.text) || item.text.length > 120000)
        return undefined;
      return {
        items: [
          {
            type: "plugin",
            id: "inline-ui",
            kind: "inline",
            version: 1,
            data: { text: item.text, phase },
          },
        ],
      };
    },
  };
