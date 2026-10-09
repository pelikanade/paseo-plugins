import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import type { z } from "zod";
import { startedNoticeSchema } from "../shared/contracts";

export function StartedNotice({
  item,
  theme,
}: PluginTimelineItemProps<z.infer<typeof startedNoticeSchema>>) {
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginVertical: 5,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.statusSuccess,
        backgroundColor: theme.colors.surface1,
        borderRadius: 7,
        gap: 3,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
        Automatic agent started
      </Text>
      <Text style={{ color: theme.colors.foreground }}>
        {item.data.subject}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {item.data.signalKind} · {item.data.repository}
      </Text>
    </View>
  );
}
