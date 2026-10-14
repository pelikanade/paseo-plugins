import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { Tone } from "./status";
import { toneColors } from "./status";

type ThemeProps = Pick<PluginHostProps, "theme">;
type LayoutProps = Pick<PluginHostProps, "theme" | "layout">;

function Dot({ theme, tone }: ThemeProps & { tone: Tone }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: theme.colors[toneColors[tone]],
      }}
    />
  );
}

export function Status({
  theme,
  tone,
  label,
}: ThemeProps & { tone: Tone; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Dot theme={theme} tone={tone} />
      <Text
        style={{
          color: theme.colors.foreground,
          fontSize: 12,
          lineHeight: 17,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function Headline({
  theme,
  children,
}: ThemeProps & { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: theme.colors.foreground,
        fontSize: 24,
        lineHeight: 30,
        fontWeight: "600",
      }}
    >
      {children}
    </Text>
  );
}

export function Heading({
  theme,
  children,
}: ThemeProps & { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: theme.colors.foreground,
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "600",
      }}
    >
      {children}
    </Text>
  );
}

export function Mono({
  theme,
  layout,
  children,
}: LayoutProps & { children: string }) {
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

export function Body({
  theme,
  muted,
  children,
}: ThemeProps & { muted?: boolean; children: ReactNode }) {
  return (
    <Text
      style={{
        color: muted ? theme.colors.foregroundMuted : theme.colors.foreground,
        fontSize: 14,
        lineHeight: 20,
      }}
    >
      {children}
    </Text>
  );
}

export function Hint({ theme, children }: ThemeProps & { children: string }) {
  return (
    <Text
      style={{
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 17,
      }}
    >
      {children}
    </Text>
  );
}

export function Field({
  theme,
  label,
  value,
}: ThemeProps & { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "baseline" }}>
      <View style={{ width: 96 }}>
        <Hint theme={theme}>{label}</Hint>
      </View>
      <View style={{ flex: 1 }}>
        <Body theme={theme}>{value}</Body>
      </View>
    </View>
  );
}

export function Panel({
  theme,
  layout,
  children,
}: LayoutProps & { children: ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface1,
        borderRadius: 10,
        padding: layout.compact ? 12 : 16,
        gap: 12,
      }}
    >
      {children}
    </View>
  );
}

export function ActionButton({
  theme,
  layout,
  label,
  accessibilityLabel,
  onPress,
  variant = "secondary",
  disabled = false,
  busy = false,
}: LayoutProps & {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
}) {
  const background =
    variant === "primary"
      ? theme.colors.accent
      : variant === "danger"
        ? theme.colors.statusDanger
        : variant === "secondary"
          ? theme.colors.surface1
          : "transparent";
  const foreground =
    variant === "primary" || variant === "danger"
      ? theme.colors.accentForeground
      : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: layout.compact || layout.platform !== "web" ? 44 : 36,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: foreground,
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
}: ThemeProps & {
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
        borderRadius: 10,
        padding: 16,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Dot theme={theme} tone={tone} />
        <Text
          style={{
            color: theme.colors.foreground,
            fontSize: 14,
            lineHeight: 20,
            fontWeight: "600",
          }}
        >
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

export function PressableRow({
  theme,
  layout,
  accessibilityLabel,
  onPress,
  children,
}: LayoutProps & {
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: layout.compact || layout.platform !== "web" ? 44 : 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 0,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: pressed ? theme.colors.surface2 : "transparent",
      })}
    >
      {children}
    </Pressable>
  );
}

export interface TableColumn {
  key: string;
  label: string;
  flex?: number;
  width?: number;
  align?: "left" | "right";
  kind?: "body" | "hint" | "mono";
}

export interface TableRow {
  key: string;
  cells: readonly (string | null)[];
}

export function Table({
  theme,
  layout,
  columns,
  rows,
}: LayoutProps & {
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
}) {
  const columnStyle = (column: TableColumn) => ({
    ...(column.flex === undefined ? {} : { flex: column.flex }),
    ...(column.width === undefined ? {} : { width: column.width }),
    alignItems:
      column.align === "right"
        ? ("flex-end" as const)
        : ("flex-start" as const),
  });
  const value = (column: TableColumn, text: string | null) => {
    if (column.kind === "body") return <Body theme={theme}>{text ?? ""}</Body>;
    if (column.kind === "mono")
      return (
        <Mono theme={theme} layout={layout}>
          {text ?? ""}
        </Mono>
      );
    return <Hint theme={theme}>{text ?? ""}</Hint>;
  };
  if (layout.compact) {
    return (
      <View style={{ gap: 12 }}>
        {rows.map((row) => (
          <View key={row.key} style={{ gap: 2 }}>
            <View
              style={{ flexDirection: "row", gap: 12, alignItems: "baseline" }}
            >
              <View style={{ flex: 1 }}>
                {value(columns[0], row.cells[0] ?? null)}
              </View>
              <View style={columnStyle({ key: "", label: "", align: "right" })}>
                {value(
                  columns[columns.length - 1],
                  row.cells[columns.length - 1] ?? null,
                )}
              </View>
            </View>
            {columns.slice(1, -1).map((column, index) => {
              const text = row.cells[index + 1] ?? null;
              if (text === null) return null;
              return (
                <View
                  key={column.key}
                  style={{
                    flexDirection: "row",
                    gap: 12,
                    alignItems: "baseline",
                  }}
                >
                  <View style={{ width: 84 }}>
                    <Hint theme={theme}>{column.label}</Hint>
                  </View>
                  <View style={{ flex: 1 }}>{value(column, text)}</View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        {columns.map((column) => (
          <View key={column.key} style={columnStyle(column)}>
            <Hint theme={theme}>{column.label}</Hint>
          </View>
        ))}
      </View>
      {rows.map((row) => (
        <View
          key={row.key}
          style={{ flexDirection: "row", gap: 12, alignItems: "baseline" }}
        >
          {columns.map((column, index) => (
            <View key={column.key} style={columnStyle(column)}>
              {value(column, row.cells[index] ?? null)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
