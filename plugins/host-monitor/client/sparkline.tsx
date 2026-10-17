import { View } from "react-native";

export function Sparkline({
  values,
  color,
  background,
  height = 28,
  slots = 60,
}: {
  values: readonly number[];
  color: string;
  background: string;
  height?: number;
  slots?: number;
}) {
  const visible =
    values.length > slots ? values.slice(values.length - slots) : values;
  const start = slots - visible.length;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: 1,
        height,
        paddingHorizontal: 1,
        paddingVertical: 1,
        borderRadius: 4,
        backgroundColor: background,
        overflow: "hidden",
      }}
    >
      {Array.from({ length: slots }, (_, index) => {
        const value = index < start ? undefined : visible[index - start];
        if (value === undefined)
          return <View key={index} style={{ flex: 1, minWidth: 1 }} />;
        return (
          <View
            key={index}
            style={{
              flex: 1,
              minWidth: 1,
              height: Math.max(
                1,
                (Math.min(100, Math.max(0, value)) / 100) * (height - 2),
              ),
              borderRadius: 1,
              backgroundColor: color,
              opacity: 0.9,
            }}
          />
        );
      })}
    </View>
  );
}
