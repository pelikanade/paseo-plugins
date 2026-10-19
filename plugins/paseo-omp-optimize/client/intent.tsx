import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { IntentItem } from "../shared/protocol";

export function IntentRow({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<IntentItem>) {
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          minHeight: layout.compact ? 28 : 32,
        },
        text: {
          color: theme.colors.foregroundMuted,
          flexShrink: 1,
          fontSize: 14,
        },
      }),
    [theme.colors.foregroundMuted, layout.compact],
  );
  return (
    <View style={styles.root} testID="paseo-omp-intent">
      <Icon name="Compass" size={12} color={theme.colors.foregroundMuted} />
      <Text style={styles.text}>{item.data.intent}</Text>
    </View>
  );
}
