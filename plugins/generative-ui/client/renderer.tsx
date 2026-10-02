import {
  createStateStore,
  JSONUIProvider,
  Renderer,
} from "@json-render/react-native";
import type {
  PluginHostProps,
  PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { cardRpc, submitRpc } from "../shared/contracts";
import type { Card, UiSpec } from "../shared/protocol";
import { formValues, validateForm, validateSpec } from "../shared/protocol";
import { parseMessage } from "../shared/stream";
import { createRegistry } from "./components";
import type { z } from "zod";
import type { inlineSchema } from "./timeline";

export function CardView({
  card,
  agentId,
  theme,
  layout,
  interactive = true,
}: PluginHostProps & { card: Card; agentId: string; interactive?: boolean }) {
  const [store] = useState(() => createStateStore(card.spec.state));
  const [eventId] = useState(
    () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const submit = useRpc(submitRpc);
  const mutation = useMutation({
    mutationFn: () =>
      submit({
        agentId,
        cardId: card.cardId,
        revision: card.revision,
        eventId,
        values: validateForm(card.spec, formValues(store.getSnapshot())),
      }),
  });
  const locked =
    !interactive ||
    card.status !== "ready" ||
    card.submitted ||
    mutation.isPending ||
    mutation.isSuccess;
  const registry = useMemo(
    () => createRegistry(theme, locked),
    [theme, locked],
  );
  useEffect(() => {
    const current = store.getSnapshot();
    const defaults = formValues(card.spec.state);
    const draft = formValues(current);
    const next: Record<string, unknown> = {
      ...card.spec.state,
      form: card.submitted
        ? defaults
        : Object.fromEntries(
            Object.entries(defaults).map(([key, value]) => [
              key,
              Object.hasOwn(draft, key) ? draft[key] : value,
            ]),
          ),
    };
    store.update(
      Object.fromEntries(
        Object.keys({ ...current, ...next }).map((key) => [
          `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
          next[key],
        ]),
      ),
    );
  }, [card.spec.state, card.submitted, store]);
  const handlers = useMemo(
    () => ({
      submit: async () => {
        try {
          await mutation.mutateAsync();
        } catch {
          return;
        }
      },
    }),
    [mutation],
  );
  let error: string | null = null;
  try {
    validateSpec(card.spec, card.status === "ready");
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Invalid UI";
  }
  return (
    <View style={{ gap: 8, paddingVertical: layout.compact ? 6 : 10 }}>
      {error ? (
        <Text style={{ color: theme.colors.statusDanger }}>
          Unable to display UI: {error}
        </Text>
      ) : (
        <JSONUIProvider store={store} handlers={handlers}>
          <Renderer
            spec={
              card.spec.root === null
                ? null
                : { ...card.spec, root: card.spec.root }
            }
            registry={registry}
            includeStandard={false}
            loading={card.status === "streaming"}
          />
        </JSONUIProvider>
      )}
      {card.status === "streaming" ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>Generating…</Text>
      ) : null}
      {card.status === "closed" ? (
        <Text style={{ color: theme.colors.foregroundMuted }}>Closed</Text>
      ) : null}
      {card.submitted || mutation.isSuccess ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: theme.colors.statusSuccess }}
        >
          {mutation.data?.delivery === "queued"
            ? "Submission saved; waiting for the agent."
            : "Submitted"}
        </Text>
      ) : null}
      {mutation.error ? (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.statusDanger }}
        >
          {mutation.error.message}
        </Text>
      ) : null}
    </View>
  );
}

export function CardRow(props: PluginTimelineItemProps<Card>) {
  return (
    <CardView
      {...props}
      card={props.item.data}
      key={`${props.agentId}:${props.item.data.cardId}`}
    />
  );
}

function InlineCard(
  props: PluginHostProps & {
    cardId: string;
    spec: UiSpec;
    complete: boolean;
    agentId: string;
  },
) {
  const fetchCard = useRpc(cardRpc);
  const query = useQuery({
    queryKey: ["generative-ui", props.host.id, props.agentId, props.cardId],
    queryFn: () => fetchCard({ agentId: props.agentId, cardId: props.cardId }),
    enabled: props.complete,
    refetchInterval: 2000,
  });
  const card = query.data?.card ?? {
    cardId: props.cardId,
    spec: props.spec,
    revision: 1,
    status: props.complete ? "ready" : "streaming",
    origin: "inline",
    submitted: false,
  };
  return (
    <CardView {...props} card={card} interactive={Boolean(query.data?.card)} />
  );
}

export function InlineRow(
  props: PluginTimelineItemProps<z.infer<typeof inlineSchema>>,
) {
  const segments = useMemo(
    () =>
      parseMessage(props.item.data.text, props.item.data.phase === "complete"),
    [props.item.data],
  );
  return (
    <View style={{ gap: 8 }}>
      {segments.map((segment, index) =>
        segment.type === "text" ? (
          <Text
            key={`text-${String(index)}`}
            selectable
            style={{ color: props.theme.colors.foreground, lineHeight: 22 }}
          >
            {segment.text}
          </Text>
        ) : (
          <View key={`${segment.cardId}:${String(index)}`}>
            <InlineCard
              {...props}
              cardId={segment.cardId}
              spec={segment.spec}
              complete={
                segment.complete &&
                props.item.data.phase === "complete" &&
                !segment.error
              }
            />
            {segment.error &&
            (segment.complete || props.item.data.phase === "complete") ? (
              <Text style={{ color: props.theme.colors.statusDanger }}>
                UI could not be completed: {segment.error}
              </Text>
            ) : null}
          </View>
        ),
      )}
    </View>
  );
}
