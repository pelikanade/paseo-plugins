import type {
  PluginAgentPanelProps,
  PluginButtonContentProps,
  PluginHostProps,
} from "@getpaseo/plugin/client";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { allowRpc, loadRpc, statusLabel, statusRpc } from "../shared/contracts";
import { refreshStatus } from "./refresh";

function StatusContent({
  agentId,
  theme,
  layout,
}: PluginHostProps & { agentId: string }) {
  const read = useRpc(statusRpc);
  const allow = useRpc(allowRpc);
  const load = useRpc(loadRpc);
  const queries = useQueryClient();
  const activity = useAgent(agentId, (agent) => agent.updatedAt);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const refresh = async () => {
    refreshStatus(agentId);
    await queries.invalidateQueries({ queryKey: ["devenv", agentId] });
  };
  const perform = async (trust: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await (trust ? allow : load)({ agentId });
      setConfirming(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  const text = { color: theme.colors.foreground };
  const button = {
    padding: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.surface1,
  };
  return (
    <ScrollView
      contentContainerStyle={{ padding: layout.compact ? 12 : 20, gap: 12 }}
    >
      <Text style={{ ...text, fontWeight: "600" }}>
        {view ? statusLabel(view) : "Loading devenv status…"}
      </Text>
      <Text selectable style={text}>
        {view?.root ??
          "No devenv.nix found in this agent’s directory or its ancestors."}
      </Text>
      {view?.needsReload ? (
        <View style={{ gap: 8 }}>
          <Text style={text}>
            Reload this agent to apply the current project environment.
            Background preparation does not update a running session.
          </Text>
          <Text selectable style={text}>{`paseo agent reload ${agentId}`}</Text>
        </View>
      ) : null}
      {view?.error || error || query.error ? (
        <Text selectable style={{ color: theme.colors.statusDanger }}>
          {error ?? view?.error ?? query.error?.message}
        </Text>
      ) : null}
      {view?.status === "denied" ? (
        confirming ? (
          <View style={{ gap: 8 }}>
            <Text style={text}>
              Allow this project to execute its devenv configuration and build
              hooks?
            </Text>
            <Text selectable style={text}>
              {view.root}
            </Text>
            <Pressable
              disabled={busy}
              style={button}
              onPress={() => {
                perform(true).catch(console.error);
              }}
            >
              <Text style={text}>{busy ? "Allowing…" : "Allow project"}</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              style={button}
              onPress={() => {
                setConfirming(false);
              }}
            >
              <Text style={text}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={button}
            onPress={() => {
              setConfirming(true);
            }}
          >
            <Text style={text}>Review project trust</Text>
          </Pressable>
        )
      ) : view?.root ? (
        <Pressable
          disabled={busy || view.status === "loading"}
          style={button}
          onPress={() => {
            perform(false).catch(console.error);
          }}
        >
          <Text style={text}>
            {view.status === "loading"
              ? "Preparing environment…"
              : "Prepare environment again"}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        style={button}
        onPress={() => {
          refresh().catch(console.error);
        }}
      >
        <Text style={text}>Refresh status</Text>
      </Pressable>
    </ScrollView>
  );
}
export function StatusPopover(props: PluginButtonContentProps) {
  return props.context === "agent" ? <StatusContent {...props} /> : null;
}
export function StatusPanel(props: PluginAgentPanelProps) {
  return <StatusContent {...props} />;
}
