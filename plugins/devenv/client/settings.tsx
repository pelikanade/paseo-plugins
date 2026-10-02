import type {
  PluginSurfaceProps,
  SettingsState,
} from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { settingsDefinition, settingsSchema } from "../shared/contracts";
import type { Settings } from "../shared/contracts";

const fields: { key: keyof Settings; label: string; numeric: boolean }[] = [
  { key: "devenvBin", label: "devenv executable", numeric: false },
  { key: "paseoBin", label: "Paseo executable", numeric: false },
  { key: "loadTimeoutMs", label: "Build timeout (ms)", numeric: true },
  {
    key: "failureRetryMs",
    label: "Failure retry interval (ms)",
    numeric: true,
  },
  { key: "maxRoots", label: "Cached projects", numeric: true },
  { key: "maxCaptureBytes", label: "Maximum captured bytes", numeric: true },
  {
    key: "runtimeDir",
    label: "Runtime directory override (empty preserves host)",
    numeric: false,
  },
];
type Ready = Extract<SettingsState<typeof settingsSchema>, { status: "ready" }>;
function Editor({
  state,
  theme,
  layout,
}: PluginSurfaceProps & { state: Ready }) {
  const [draft, setDraft] = useState(
    Object.fromEntries(
      fields.map(({ key }) => [key, String(state.values[key])]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const parsed = settingsSchema.safeParse(
      Object.fromEntries(
        fields.map(({ key, numeric }) => [
          key,
          numeric ? Number(draft[key]) : draft[key],
        ]),
      ),
    );
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("\n"),
      );
      return;
    }
    setError(null);
    await state.save(parsed.data, state.revision);
  };
  const text = { color: theme.colors.foreground };
  return (
    <ScrollView
      contentContainerStyle={{ padding: layout.compact ? 12 : 24, gap: 12 }}
    >
      <Text style={text}>
        Changing settings invalidates cached environments. Reload running agents
        after preparation completes.
      </Text>
      {fields.map(({ key, label, numeric }) => (
        <View key={key} style={{ gap: 6 }}>
          <Text style={text}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            editable={!state.saving}
            keyboardType={numeric ? "numeric" : "default"}
            value={draft[key]}
            placeholder={label}
            onChangeText={(value) => {
              setDraft((current) => ({ ...current, [key]: value }));
            }}
            style={{
              ...text,
              padding: 10,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 8,
            }}
          />
        </View>
      ))}
      {(error ?? state.saveError) ? (
        <Text selectable style={{ color: theme.colors.statusDanger }}>
          {error ?? state.saveError}
        </Text>
      ) : null}
      <Pressable
        disabled={state.saving}
        onPress={() => {
          save().catch(console.error);
        }}
      >
        <Text style={text}>{state.saving ? "Saving…" : "Save settings"}</Text>
      </Pressable>
      <Pressable
        disabled={state.saving}
        onPress={() => {
          state.reset().catch(console.error);
        }}
      >
        <Text style={text}>Reset defaults</Text>
      </Pressable>
      <Pressable
        disabled={state.saving}
        onPress={() => {
          state.reload().catch(console.error);
        }}
      >
        <Text style={text}>Reload settings</Text>
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
