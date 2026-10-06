import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { statusRpc, stopRpc } from "../shared/contracts";

function dueLabel(value: string | null): string {
  if (value === null) return "not scheduled";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const seconds = Math.max(0, Math.round((time - Date.now()) / 1000));
  return `${value} (${seconds.toString()}s)`;
}

export function LoopPanel(props: PluginAgentPanelProps) {
  const read = useRpc(statusRpc);
  const stop = useRpc(stopRpc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["loop", props.host.id, props.agentId],
    queryFn: () => read({ agentId: props.agentId }),
    refetchInterval: 2000,
  });
  const view = query.data;
  const failure = error ?? view?.error ?? query.error?.message ?? null;
  return (
    <View
      style={{
        flex: 1,
        gap: 12,
        padding: props.layout.compact ? 12 : 20,
        backgroundColor: props.theme.colors.surface0,
      }}
    >
      <Text style={{ color: props.theme.colors.foreground, fontSize: 18 }}>
        Loop
      </Text>
      {failure ? (
        <Text style={{ color: props.theme.colors.statusDanger }}>
          {failure}
        </Text>
      ) : null}
      {view?.state === "armed" ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: props.theme.colors.foreground }}>
            {view.mode} · {view.purpose}
          </Text>
          <Text style={{ color: props.theme.colors.foregroundMuted }}>
            {view.prompt}
          </Text>
          <Text style={{ color: props.theme.colors.foregroundMuted }}>
            Next wake {dueLabel(view.nextDueAt)}
          </Text>
          {view.watcher !== "off" ? (
            <Text style={{ color: props.theme.colors.foregroundMuted }}>
              Watcher {view.watcher}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Stop loop"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              setError(null);
              stop({ agentId: props.agentId })
                .then(() => query.refetch())
                .then(() => {
                  setBusy(false);
                })
                .catch((caught: unknown) => {
                  setBusy(false);
                  setError(
                    caught instanceof Error ? caught.message : "Stop failed",
                  );
                });
            }}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              backgroundColor: props.theme.colors.accent,
            }}
          >
            <Text style={{ color: props.theme.colors.accentForeground }}>
              Stop loop
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text style={{ color: props.theme.colors.foregroundMuted }}>
          No loop is armed. Use /loop [interval] &lt;prompt&gt;.
        </Text>
      )}
    </View>
  );
}
