import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { toneColors } from "./presentation";
import type { Tone } from "./presentation";

export function ActionButton({
  theme,
  layout,
  label,
  onPress,
  variant = "secondary",
  disabled = false,
  busy = false,
}: PluginHostProps & {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost";
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: layout.compact || layout.platform !== "web" ? 44 : 36,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          variant === "primary"
            ? theme.colors.accent
            : variant === "secondary"
              ? theme.colors.surface1
              : "transparent",
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: theme.colors.border,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color:
            variant === "primary"
              ? theme.colors.accentForeground
              : variant === "ghost"
                ? theme.colors.foregroundMuted
                : theme.colors.foreground,
          fontSize: 14,
          lineHeight: 20,
          fontWeight: variant === "primary" ? "600" : "500",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Notice({
  theme,
  tone,
  title,
  children,
}: Pick<PluginHostProps, "theme"> & {
  tone: Tone;
  title: string;
  children: ReactNode;
}) {
  return (
    <View
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      accessibilityLiveRegion={tone === "danger" ? "polite" : undefined}
      style={{
        backgroundColor: theme.colors.surface1,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors[toneColors[tone]],
        borderRadius: 8,
        padding: 12,
        gap: 8,
      }}
    >
      <Text
        style={{
          color:
            tone === "danger"
              ? theme.colors.statusDanger
              : theme.colors.foreground,
          fontSize: 13,
          lineHeight: 19,
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Mono({
  theme,
  layout,
  children,
}: Pick<PluginHostProps, "theme" | "layout"> & { children: string }) {
  return (
    <Text
      selectable
      style={{
        color: theme.colors.foregroundMuted,
        fontFamily: layout.platform === "ios" ? "Menlo" : "monospace",
        fontSize: 12,
        lineHeight: 17,
        flexShrink: 1,
      }}
    >
      {children}
    </Text>
  );
}
