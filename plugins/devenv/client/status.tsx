import type {
  PluginAgentPanelProps,
  PluginButtonContentProps,
  PluginHostProps,
} from "@getpaseo/plugin/client";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { allowRpc, loadRpc, statusRpc } from "../shared/contracts";
import { describe, toneColors } from "./presentation";
import { refreshStatus } from "./refresh";
import { ActionButton, Mono, Notice } from "./ui";

function StatusContent({
  agentId,
  theme,
  layout,
  host,
  variant,
  onClose,
}: PluginHostProps & {
  agentId: string;
  variant: "popover" | "panel";
  onClose?: () => void;
}) {
  const read = useRpc(statusRpc);
  const allow = useRpc(allowRpc);
  const load = useRpc(loadRpc);
  const queries = useQueryClient();
  const activity = useAgent(agentId, (agent) => agent.updatedAt);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery({
    queryKey: ["devenv", agentId, activity],
    queryFn: () => read({ agentId }),
    refetchInterval: (current) =>
      current.state.data?.status === "loading" &&
      current.state.dataUpdateCount < 90
        ? 1500
        : 5000,
  });
  const view = query.data;
  const presentation = describe(view);
  const appearance = { theme, layout, host };
  const failure = error ?? view?.error ?? query.error?.message;
  const invalidate = async () => {
    refreshStatus(agentId);
    await queries.invalidateQueries(
      { queryKey: ["devenv", agentId] },
      { throwOnError: true },
    );
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await invalidate();
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  };
  const perform = async (trust: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await (trust ? allow : load)({ agentId });
      setConfirming(false);
      await invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const body = {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 19,
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flexShrink: 1, minWidth: 0 }}
      contentContainerStyle={{
        padding: layout.compact ? 12 : variant === "popover" ? 16 : 20,
      }}
    >
      <View
        style={{
          gap: 12,
          width: "100%",
          maxWidth: variant === "panel" ? 560 : undefined,
          alignSelf: "flex-start",
        }}
      >
        <View
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 10,
              height: 10,
              marginTop: 6,
              borderRadius: 6,
              backgroundColor: theme.colors[toneColors[presentation.tone]],
            }}
          />
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              style={{
                color: theme.colors.foreground,
                fontSize: 16,
                lineHeight: 22,
                fontWeight: "600",
              }}
            >
              {presentation.headline}
            </Text>
            {presentation.summary ? (
              <Text style={{ ...body, color: theme.colors.foregroundMuted }}>
                {presentation.summary}
              </Text>
            ) : null}
          </View>
          {onClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close devenv status"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
                backgroundColor: pressed
                  ? theme.colors.surface1
                  : "transparent",
              })}
            >
              <Icon name="X" size={16} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>

        {view?.root && view.status === "denied" ? (
          <Mono {...appearance}>{view.root}</Mono>
        ) : null}

        {view?.needsReload ? (
          <Notice theme={theme} tone="warning" title="Update this session">
            <Text style={body}>
              {view.root === null || view.status === "denied"
                ? "Reload this agent to return to the host environment."
                : view.status === "loading"
                  ? "Wait for preparation to finish, then reload this agent to apply the updated environment."
                  : view.status === "error" || view.status === "detected"
                    ? "Prepare the environment, then reload this agent to apply it."
                    : "Reload this agent to apply the current project environment."}
            </Text>
            <Text style={{ ...body, color: theme.colors.foregroundMuted }}>
              Background preparation does not update a running session.
            </Text>
            <View
              style={{
                padding: 8,
                borderRadius: 6,
                backgroundColor: theme.colors.surface2,
              }}
            >
              <Mono {...appearance}>{`paseo agent reload ${agentId}`}</Mono>
            </View>
          </Notice>
        ) : null}

        {failure ? (
          <Notice theme={theme} tone="danger" title="Error">
            <Text selectable style={body}>
              {failure}
            </Text>
          </Notice>
        ) : null}

        {view?.status === "denied" && confirming ? (
          <Notice
            theme={theme}
            tone="warning"
            title="Allow this project to run code?"
          >
            <Text style={body}>
              Allow this project to execute its devenv configuration and build
              hooks?
            </Text>
          </Notice>
        ) : null}

        <View style={{ gap: 8 }}>
          {view?.status === "denied" ? (
            confirming ? (
              <View style={{ gap: 8 }}>
                <ActionButton
                  {...appearance}
                  variant="primary"
                  disabled={busy}
                  busy={busy}
                  label={busy ? "Allowing…" : "Allow project"}
                  onPress={() => {
                    perform(true).catch(console.error);
                  }}
                />
                <ActionButton
                  {...appearance}
                  disabled={busy}
                  label="Cancel"
                  onPress={() => {
                    setConfirming(false);
                    setError(null);
                  }}
                />
              </View>
            ) : (
              <ActionButton
                {...appearance}
                variant="primary"
                label="Review project trust"
                onPress={() => {
                  setConfirming(true);
                }}
              />
            )
          ) : view?.root ? (
            <ActionButton
              {...appearance}
              variant={
                !view.needsReload &&
                (view.status === "error" || view.status === "detected")
                  ? "primary"
                  : "secondary"
              }
              disabled={busy || view.status === "loading"}
              busy={busy || view.status === "loading"}
              label={
                busy || view.status === "loading"
                  ? "Preparing environment…"
                  : "Reload environment"
              }
              onPress={() => {
                perform(false).catch(console.error);
              }}
            />
          ) : null}
          {view?.status !== "denied" || !confirming ? (
            <ActionButton
              {...appearance}
              variant="ghost"
              disabled={busy || refreshing}
              busy={refreshing}
              label={refreshing ? "Refreshing…" : "Refresh status"}
              onPress={() => {
                refresh().catch(console.error);
              }}
            />
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}
export function StatusPopover(props: PluginButtonContentProps) {
  return props.context === "agent" ? (
    <StatusContent
      {...props}
      variant="popover"
      onClose={() => {
        props.close();
      }}
    />
  ) : null;
}
export function StatusPanel(props: PluginAgentPanelProps) {
  return <StatusContent {...props} variant="panel" />;
}
