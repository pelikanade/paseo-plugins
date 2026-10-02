import type { PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text } from "react-native";
import { listRpc } from "../shared/contracts";
import { CardView } from "./renderer";

export function CardsPanel(props: PluginAgentPanelProps) {
  const list = useRpc(listRpc);
  const query = useQuery({
    queryKey: ["generative-ui-cards", props.host.id, props.agentId],
    queryFn: () => list({ agentId: props.agentId }),
    refetchInterval: 2000,
  });
  return (
    <ScrollView
      contentContainerStyle={{
        padding: props.layout.compact ? 12 : 20,
        gap: 12,
      }}
      style={{ backgroundColor: props.theme.colors.surface0 }}
    >
      <Text style={{ color: props.theme.colors.foreground, fontSize: 18 }}>
        Generative UI
      </Text>
      {query.error ? (
        <Text style={{ color: props.theme.colors.statusDanger }}>
          {query.error.message}
        </Text>
      ) : null}
      {query.data?.cards.length === 0 ? (
        <Text style={{ color: props.theme.colors.foregroundMuted }}>
          Ask the agent to show a comparison, choice or form.
        </Text>
      ) : null}
      {query.data?.cards.map((card) => (
        <CardView
          key={`${props.agentId}:${card.cardId}`}
          {...props}
          card={card}
        />
      ))}
    </ScrollView>
  );
}
