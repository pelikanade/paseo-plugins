import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useHosts } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import type { InjectionFile } from "../shared/contracts";
import {
  copy,
  formatBytes,
  relativeTime,
  toneFor,
  useVaultStatus,
} from "./status";
import {
  ActionButton,
  Body,
  ErrorNotice,
  Field,
  Headline,
  Heading,
  Hint,
  Notice,
  Panel,
  Status,
  Table,
} from "./ui";

function skillStatus(file: InjectionFile): string {
  switch (file.status) {
    case "injected":
      return copy.status.injected;
    case "truncated":
      return copy.status.truncated;
    case "not_injected":
      return copy.status.skipped;
  }
}

export function createVaultScreen(openSettings: () => void) {
  return function VaultScreen({ theme, layout, host }: PluginScreenProps) {
    const status = useVaultStatus();
    const toast = useToast();
    const hosts = useHosts();
    const view = status.data;
    const offline = hosts.some(
      (entry) =>
        (entry.serverId === host.id || entry.label === host.label) &&
        (entry.status === "offline" || entry.status === "error"),
    );
    const previousState = useRef<string | null>(null);
    const currentState = view?.state;
    useEffect(() => {
      if (currentState === undefined) return;
      const before = previousState.current;
      previousState.current = currentState;
      if (
        currentState === "watching" &&
        (before === "error" || before === "stale")
      )
        toast.show(copy.recovered);
    }, [currentState, toast]);
    const padding = layout.compact ? 12 : 24;
    const state = view?.state ?? "unconfigured";
    const skills = view?.injection.skills ?? [];
    const vaultName = view?.vault?.name ?? copy.title;
    const banner = view?.error ? copy.errors[view.error.code] : null;

    return (
      <ScrollView
        contentContainerStyle={{
          padding,
          gap: 16,
          width: "100%",
          maxWidth: 760,
          alignSelf: "center",
        }}
        style={{ backgroundColor: theme.colors.surface0, flex: 1 }}
      >
        <View style={{ gap: 8 }}>
          <Headline theme={theme}>{vaultName}</Headline>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <Status
              theme={theme}
              tone={toneFor(state)}
              label={copy.state[state]}
            />
            {view?.pulling ? (
              <Status theme={theme} tone="accent" label={copy.syncing} />
            ) : null}
            <Hint theme={theme}>{copy.readOnly}</Hint>
            <View style={{ flex: 1 }} />
            <ActionButton
              theme={theme}
              layout={layout}
              variant="ghost"
              label={copy.openSettings}
              accessibilityLabel={`${copy.openSettings}, ${copy.title}`}
              onPress={openSettings}
            />
          </View>
          {offline ? (
            <Hint theme={theme}>{copy.offline(host.label)}</Hint>
          ) : null}
        </View>

        {status.isError ? (
          <Notice theme={theme} tone="danger" title={copy.unknown}>
            <Body theme={theme}>{copy.statusReadError(host.label)}</Body>
            <Hint theme={theme}>
              {status.error instanceof Error
                ? status.error.message
                : String(status.error)}
            </Hint>
          </Notice>
        ) : null}
        {banner ? (
          <ErrorNotice
            theme={theme}
            title={banner.title}
            body={banner.body}
            action={banner.action}
          />
        ) : null}
        {state === "stale" ? (
          <Notice theme={theme} tone="warning" title={copy.state.stale}>
            <Body theme={theme}>
              {copy.staleBanner(relativeTime(view?.lastSuccessAt ?? null))}
            </Body>
          </Notice>
        ) : null}

        <Field
          theme={theme}
          label={copy.lastSync}
          value={relativeTime(view?.lastSuccessAt ?? null)}
        />
        <Field theme={theme} label="Tools" value={copy.tools} />

        <View style={{ gap: 8 }}>
          <Heading theme={theme}>{copy.skillsHeading}</Heading>
          <Panel theme={theme} layout={layout}>
            <Table
              theme={theme}
              layout={layout}
              columns={[
                {
                  key: "skill",
                  label: copy.skillColumns.skill,
                  flex: 2,
                  kind: "body",
                },
                {
                  key: "description",
                  label: copy.skillColumns.description,
                  flex: 3,
                },
                {
                  key: "status",
                  label: copy.skillColumns.status,
                  width: 110,
                },
                {
                  key: "size",
                  label: copy.skillColumns.size,
                  width: 72,
                  align: "right",
                  kind: "mono",
                },
              ]}
              rows={skills.map((skill) => ({
                key: skill.path,
                cells: [
                  skill.name ?? skill.path,
                  skill.description,
                  skillStatus(skill),
                  formatBytes(skill.bytes),
                ],
              }))}
            />
            {skills.length === 0 ? (
              <Hint theme={theme}>{copy.skillsNone}</Hint>
            ) : null}
          </Panel>
        </View>
      </ScrollView>
    );
  };
}
