import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { describeState, statusRpc } from "../shared/status";
import type { StatusView } from "../shared/status";

type Reading =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; view: StatusView };

export function StatusPanel({ agentId, theme, layout }: PluginAgentPanelProps) {
  const read = useRpc(statusRpc);
  const [reading, setReading] = useState<Reading>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    read({ agentId })
      .then((view) => {
        if (alive) setReading({ kind: "ready", view });
      })
      .catch((error: unknown) => {
        if (alive)
          setReading({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      alive = false;
    };
  }, [agentId]);
  const text = { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 };
  const presentation =
    reading.kind === "ready" ? describeState(reading.view) : null;
  return (
    <ScrollView
      contentContainerStyle={{ padding: layout.compact ? 12 : 20, gap: 8 }}
    >
      <View style={{ gap: 6, maxWidth: 560 }}>
        <Text
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
          style={{ ...text, fontSize: 16, lineHeight: 22, fontWeight: "600" }}
        >
          {presentation
            ? presentation.headline
            : reading.kind === "loading"
              ? "Checking Paseo first directive…"
              : "Paseo first directive: unavailable"}
        </Text>
        <Text style={{ ...text, color: theme.colors.foregroundMuted }}>
          {presentation
            ? presentation.detail
            : reading.kind === "error"
              ? reading.message
              : ""}
        </Text>
        {reading.kind === "ready" ? (
          <Text style={{ ...text, color: theme.colors.foregroundMuted }}>
            {reading.view.enabled
              ? "Plugin setting: enabled for new agents."
              : "Plugin setting: disabled for new agents."}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
