import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";

const FILLER_ONLY_PATTERN = /^[.\u2026\s]*[.\u2026][.\u2026\s]*$/;

export const fillerTextTransformer: PluginTimelineTransformerContribution<"assistant_message"> =
  {
    id: "filler-text",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      return FILLER_ONLY_PATTERN.test(item.text) ? { items: [] } : undefined;
    },
  };
