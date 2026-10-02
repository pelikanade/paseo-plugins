import type { PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { ComponentType } from "react";
import { View } from "react-native";
import { toneColors } from "./presentation";
import type { Tone } from "./presentation";

function createIcon(tone: Tone): ComponentType<PluginButtonIconProps> {
  return function StatusIcon({ size, color, theme }) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: size, height: size }}
      >
        <Icon name="Leaf" size={size} color={color} />
        <View
          style={{
            position: "absolute",
            right: -2,
            bottom: -2,
            width: 7,
            height: 7,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: theme.colors.surface0,
            backgroundColor: theme.colors[toneColors[tone]],
          }}
        />
      </View>
    );
  };
}

export const statusIcons = {
  neutral: createIcon("neutral"),
  accent: createIcon("accent"),
  success: createIcon("success"),
  warning: createIcon("warning"),
  danger: createIcon("danger"),
};
