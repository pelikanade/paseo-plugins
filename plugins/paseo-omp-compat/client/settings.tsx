import type {
  PluginSurfaceProps,
  SettingsState,
} from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { settingsDefinition, settingsSchema } from "../shared/paseo-first";

type Ready = Extract<SettingsState<typeof settingsSchema>, { status: "ready" }>;

function Editor({
  state,
  theme,
  layout,
}: PluginSurfaceProps & { state: Ready }) {
  const [enabled, setEnabled] = useState(state.values.enabled);
  const [textOverride, setTextOverride] = useState(state.values.textOverride);
  const text = { color: theme.colors.foreground };
  const button = {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    alignItems: "center" as const,
    minHeight: layout.compact ? 44 : 36,
    justifyContent: "center" as const,
  };
  return (
    <ScrollView
      contentContainerStyle={{ padding: layout.compact ? 12 : 24, gap: 12 }}
    >
      <Text style={text}>
        Applies to agents created after saving. Running agents keep the system
        prompt they started with.
      </Text>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel="Append the Paseo first directive"
        accessibilityState={{ checked: enabled, disabled: state.saving }}
        disabled={state.saving}
        onPress={() => {
          setEnabled((current) => !current);
        }}
        style={button}
      >
        <Text style={text}>
          {enabled ? "Directive enabled" : "Directive disabled"}
        </Text>
      </Pressable>
      <View style={{ gap: 6 }}>
        <Text style={text}>
          Text override (empty uses the built-in directive)
        </Text>
        <TextInput
          accessibilityLabel="Directive text override"
          editable={!state.saving}
          multiline
          value={textOverride}
          placeholder="Built-in directive"
          placeholderTextColor={theme.colors.foregroundMuted}
          onChangeText={setTextOverride}
          style={{
            ...text,
            minHeight: 160,
            padding: 10,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 8,
            textAlignVertical: "top",
          }}
        />
      </View>
      {state.saveError ? (
        <Text selectable style={{ color: theme.colors.statusDanger }}>
          {state.saveError}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={state.saving}
        onPress={() => {
          state
            .save(
              settingsSchema.parse({ enabled, textOverride }),
              state.revision,
            )
            .catch(console.error);
        }}
        style={button}
      >
        <Text style={text}>{state.saving ? "Saving…" : "Save settings"}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={state.saving}
        onPress={() => {
          state.reset().catch(console.error);
        }}
        style={button}
      >
        <Text style={text}>Reset defaults</Text>
      </Pressable>
    </ScrollView>
  );
}

export function SettingsScreen(props: PluginSurfaceProps) {
  const state = useSettings(settingsDefinition);
  if (state.status === "ready")
    return <Editor key={state.revision} {...props} state={state} />;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Text style={{ color: props.theme.colors.foreground }}>
        {state.status === "loading" ? "Loading settings…" : state.error}
      </Text>
      {state.status === "invalid" ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            state.reset().catch(console.error);
          }}
        >
          <Text style={{ color: props.theme.colors.foreground }}>
            Reset defaults
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
