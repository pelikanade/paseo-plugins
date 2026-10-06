import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { z } from "zod";

export const noticeSchema = z
  .object({ text: z.string().min(1).max(4000) })
  .strict();

export function NoticeRow({
  item,
  theme,
}: PluginTimelineItemProps<z.infer<typeof noticeSchema>>) {
  return (
    <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
      <Text style={{ color: theme.colors.foreground }}>{item.data.text}</Text>
    </View>
  );
}
