import { defineRegistry, useBoundProp } from "@json-render/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { catalog } from "../shared/catalog";

export function createRegistry(theme: PluginTheme, locked: boolean) {
  const styles = StyleSheet.create({
    card: {
      padding: 16,
      gap: 12,
      borderWidth: 1,
      borderRadius: 12,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    },
    text: { color: theme.colors.foreground, fontSize: 14, lineHeight: 21 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
    heading: {
      color: theme.colors.foreground,
      fontSize: 18,
      fontWeight: "600",
    },
    metric: { color: theme.colors.foreground, fontSize: 26, fontWeight: "600" },
    field: { gap: 6 },
    input: {
      color: theme.colors.foreground,
      padding: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface2,
      borderRadius: 6,
    },
    button: {
      padding: 12,
      borderRadius: 6,
      backgroundColor: theme.colors.accent,
      opacity: locked ? 0.5 : 1,
    },
    buttonText: { color: theme.colors.accentForeground, fontWeight: "600" },
    option: {
      padding: 10,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      opacity: locked ? 0.5 : 1,
    },
    selected: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surface2,
    },
    row: { flexDirection: "row", gap: 8, alignItems: "center" },
    cell: { flex: 1, padding: 8, minWidth: 80, color: theme.colors.foreground },
    table: { minWidth: 320 },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
  });
  return defineRegistry(catalog, {
    components: {
      Card: ({ props, children }) => (
        <View style={styles.card}>
          {props.title ? (
            <Text style={styles.heading}>{props.title}</Text>
          ) : null}
          {children}
        </View>
      ),
      Stack: ({ props, children }) => (
        <View
          style={{
            flexDirection: props.direction ?? "column",
            gap: props.gap === "sm" ? 6 : props.gap === "lg" ? 18 : 12,
            flexWrap: "wrap",
          }}
        >
          {children}
        </View>
      ),
      Text: ({ props }) => (
        <Text selectable style={styles.text}>
          {props.text}
        </Text>
      ),
      Heading: ({ props }) => (
        <Text accessibilityRole="header" style={styles.heading}>
          {props.text}
        </Text>
      ),
      Divider: () => (
        <View
          testID="generative-ui-divider"
          style={{ height: 1, backgroundColor: theme.colors.border }}
        />
      ),
      Metric: ({ props }) => (
        <View style={styles.field}>
          <Text style={styles.muted}>{props.label}</Text>
          <Text style={styles.metric}>{String(props.value)}</Text>
          {props.detail ? (
            <Text style={styles.muted}>{props.detail}</Text>
          ) : null}
        </View>
      ),
      Badge: ({ props }) => (
        <Text
          style={[
            styles.text,
            {
              color:
                props.tone === "success"
                  ? theme.colors.statusSuccess
                  : props.tone === "warning"
                    ? theme.colors.statusWarning
                    : props.tone === "danger"
                      ? theme.colors.statusDanger
                      : theme.colors.foreground,
            },
          ]}
        >
          {props.label}
        </Text>
      ),
      Progress: ({ props }) => (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={props.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(props.value * 100)}
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(props.value * 100),
          }}
          style={styles.field}
        >
          <Text style={styles.text}>
            {props.label} · {Math.round(props.value * 100)}%
          </Text>
          <View
            style={{
              height: 6,
              borderRadius: 3,
              backgroundColor: theme.colors.surface2,
              flexDirection: "row",
            }}
          >
            <View
              style={{
                height: 6,
                flex: props.value,
                borderRadius: 3,
                backgroundColor: theme.colors.accent,
              }}
            />
            <View style={{ flex: 1 - props.value }} />
          </View>
        </View>
      ),
      KeyValue: ({ props }) => (
        <View style={styles.row}>
          <Text style={styles.muted}>{props.label}</Text>
          <Text selectable style={styles.text}>
            {String(props.value)}
          </Text>
        </View>
      ),
      Table: ({ props }) => (
        <ScrollView horizontal>
          <View style={styles.table}>
            <View style={styles.tableRow}>
              {props.columns.map((column, index) => (
                <Text key={index} style={[styles.cell, { fontWeight: "600" }]}>
                  {column}
                </Text>
              ))}
            </View>
            {props.rows.map((row, index) => (
              <View key={index} style={styles.tableRow}>
                {row.map((value, cell) => (
                  <Text key={cell} selectable style={styles.cell}>
                    {value === null ? "" : String(value)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      ),
      ChoiceGroup: ({ props, bindings }) => {
        const [value, setValue] = useBoundProp(props.value, bindings?.value);
        return (
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={props.label}
            style={styles.field}
          >
            <Text style={styles.text}>{props.label}</Text>
            {props.options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                aria-checked={value === option.value}
                aria-disabled={locked}
                accessibilityState={{
                  checked: value === option.value,
                  disabled: locked,
                }}
                disabled={locked}
                onPress={() => {
                  setValue(option.value);
                }}
                style={[
                  styles.option,
                  value === option.value ? styles.selected : undefined,
                ]}
              >
                <Text style={styles.text}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        );
      },
      TextInput: ({ props, bindings }) => {
        const [value, setValue] = useBoundProp(props.value, bindings?.value);
        return (
          <View style={styles.field}>
            <Text style={styles.text}>{props.label}</Text>
            <TextInput
              accessibilityLabel={props.label}
              value={value ?? ""}
              editable={!locked}
              maxLength={props.maxLength ?? 8000}
              placeholder={props.placeholder}
              placeholderTextColor={theme.colors.foregroundMuted}
              onChangeText={setValue}
              style={styles.input}
            />
          </View>
        );
      },
      Checkbox: ({ props, bindings }) => {
        const [checked, setChecked] = useBoundProp(
          props.checked,
          bindings?.checked,
        );
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={props.label}
            accessibilityState={{ checked: checked ?? false, disabled: locked }}
            aria-checked={checked ?? false}
            aria-disabled={locked}
            disabled={locked}
            onPress={() => {
              setChecked(!checked);
            }}
            style={[styles.option, styles.row]}
          >
            <Text style={styles.text}>{checked ? "☑" : "☐"}</Text>
            <Text style={styles.text}>{props.label}</Text>
          </Pressable>
        );
      },
      Button: ({ props, emit }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.label}
          accessibilityState={{ disabled: locked }}
          aria-disabled={locked}
          disabled={locked}
          style={[
            styles.button,
            props.variant === "secondary"
              ? { backgroundColor: theme.colors.surface2 }
              : undefined,
          ]}
          onPress={() => {
            emit("press");
          }}
        >
          <Text
            style={[
              styles.buttonText,
              props.variant === "secondary" ? styles.text : undefined,
            ]}
          >
            {props.label}
          </Text>
        </Pressable>
      ),
    },
  }).registry;
}
