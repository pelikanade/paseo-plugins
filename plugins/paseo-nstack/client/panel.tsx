import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  checkNowRpc,
  panelRpc,
  saveSettingsRpc,
  setPauseRpc,
  testConnectionRpc,
  type Binding,
  type GitHubProblem,
  type PluginDefaults,
  type ProviderChoice,
} from "../shared/contracts";

type Theme = PluginWorkspacePanelProps["theme"];

interface ActionProps {
  theme: Theme;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  onPress: () => void;
}

function Action({
  theme,
  label,
  disabled = false,
  primary = false,
  danger = false,
  onPress,
}: ActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 36,
        justifyContent: "center",
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderWidth: primary ? 0 : 1,
        borderColor: danger ? theme.colors.statusDanger : theme.colors.border,
        borderRadius: 7,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface1,
        opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
      })}
    >
      <Text
        style={{
          color: primary
            ? theme.colors.accentForeground
            : danger
              ? theme.colors.statusDanger
              : theme.colors.foreground,
          fontSize: 13,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Input({
  theme,
  label,
  value,
  placeholder,
  onChange,
}: {
  theme: Theme;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ flex: 1, minWidth: 160, gap: 5 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          minHeight: 38,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: 7,
          paddingHorizontal: 10,
          paddingVertical: 7,
        }}
      />
    </View>
  );
}

function Choice({
  theme,
  label,
  selected,
  disabled = false,
  onPress,
}: {
  theme: Theme;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected
          ? theme.colors.surface2
          : theme.colors.surface1,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        style={{
          color: selected
            ? theme.colors.foreground
            : theme.colors.foregroundMuted,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  theme,
  title,
  children,
}: {
  theme: Theme;
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 9 }}>
      <Text
        style={{
          color: theme.colors.foreground,
          fontSize: 14,
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

function AccessNotice({
  theme,
  problem,
  busy,
  onRetry,
}: {
  theme: Theme;
  problem: GitHubProblem;
  busy: boolean;
  onRetry: () => void;
}) {
  const titles: Record<GitHubProblem["kind"], string> = {
    authentication: "GitHub sign-in is not valid",
    permission: "GitHub denied access",
  };
  const hostname = /^[a-zA-Z0-9.-]+$/.test(problem.hostname)
    ? problem.hostname
    : `'${problem.hostname.replace(/'/g, "'\\''")}'`;
  const command =
    problem.kind === "authentication"
      ? `gh auth login --hostname ${hostname}`
      : null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityState={{ busy }}
      style={{
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderLeftColor: theme.colors.statusDanger,
        borderLeftWidth: 3,
        borderRadius: 8,
        padding: 14,
        gap: 10,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: theme.colors.foreground,
          fontWeight: "600",
          fontSize: 14,
        }}
      >
        {titles[problem.kind]}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
        {problem.message}
      </Text>
      {command ? (
        <>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            On the machine running Paseo, run this command and complete GitHub
            authorization:
          </Text>
          <Text
            selectable
            style={{
              color: theme.colors.foreground,
              backgroundColor: theme.colors.surface2,
              padding: 10,
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            {command}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            Then check again. No plugin reload is needed for GitHub CLI
            credential changes. If gh uses GH_TOKEN or GITHUB_TOKEN, update the
            daemon's environment and restart Paseo to apply it.
          </Text>
        </>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Check the GitHub account's repository and Issues access, token
          permissions, and organization authorization.
        </Text>
      )}
      <View style={{ alignItems: "flex-start" }}>
        <Action
          theme={theme}
          label={busy ? "Checking…" : "Check again"}
          primary
          disabled={busy}
          onPress={onRetry}
        />
      </View>
    </View>
  );
}

function relativeTime(value: string | null) {
  if (!value) return "never";
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000);
  if (seconds < 60) return `${Math.max(0, seconds).toString()}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60).toString()}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600).toString()}h ago`;
  return `${Math.round(seconds / 86_400).toString()}d ago`;
}

export function NstackPanel(props: PluginWorkspacePanelProps) {
  const readPanel = useRpc(panelRpc);
  const saveSettings = useRpc(saveSettingsRpc);
  const testConnection = useRpc(testConnectionRpc);
  const setPause = useRpc(setPauseRpc);
  const checkNow = useRpc(checkNowRpc);
  const query = useQuery({
    queryKey: ["paseo-nstack", props.host.id, props.workspaceId],
    queryFn: () => readPanel({ workspaceId: props.workspaceId }),
    refetchInterval: 5000,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{
    message: string;
    githubProblem: GitHubProblem | null;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [repository, setRepository] = useState("");
  const [checkEvery, setCheckEvery] = useState("60");
  const [repairEvery, setRepairEvery] = useState("3600");
  const [automaticStarts, setAutomaticStarts] = useState(true);
  const [defaultAgent, setDefaultAgent] = useState<ProviderChoice | null>(null);
  const [overrideAgent, setOverrideAgent] = useState<ProviderChoice | null>(
    null,
  );
  const view = query.data;

  function perform(
    label: string,
    work: () => Promise<GitHubProblem | undefined>,
  ) {
    setBusy(label);
    setMessage(null);
    Promise.resolve()
      .then(work)
      .then((problem) => {
        setError(
          problem ? { message: problem.message, githubProblem: problem } : null,
        );
        return query.refetch();
      })
      .catch((caught: unknown) => {
        setError({
          message: caught instanceof Error ? caught.message : `${label} failed`,
          githubProblem: null,
        });
      })
      .finally(() => {
        setBusy(null);
      });
  }

  function openSettings() {
    if (!view) return;
    const binding = view.binding;
    setOwner(binding?.repository.owner ?? "");
    setRepository(binding?.repository.name ?? "");
    setCheckEvery((binding?.checkEverySeconds ?? 60).toString());
    setRepairEvery(binding?.repairEverySeconds?.toString() ?? "");
    setAutomaticStarts(view.defaults.automaticStarts);
    setDefaultAgent(view.defaults.agent);
    setOverrideAgent(binding?.agent ?? null);
    setError(
      view.health.githubProblem
        ? {
            message: view.health.message,
            githubProblem: view.health.githubProblem,
          }
        : null,
    );
    setMessage(null);
    setSettingsOpen(true);
  }

  function testGitHubConnection() {
    perform("test", async () => {
      const result = await testConnection({
        workspaceId: props.workspaceId,
        defaults: defaults(),
        binding: selectedBinding(),
      });
      if (!result.ok) {
        if (result.githubProblem) return result.githubProblem;
        throw new Error(result.message);
      }
      setMessage(result.message);
    });
  }

  function selectedBinding(): Binding {
    const checkSeconds = Number(checkEvery);
    const repairSeconds = repairEvery.trim() ? Number(repairEvery) : null;
    if (!owner.trim() || !repository.trim())
      throw new Error("Enter a GitHub owner and repository");
    if (!Number.isInteger(checkSeconds) || checkSeconds < 10)
      throw new Error("Check interval must be at least 10 seconds");
    if (
      repairSeconds !== null &&
      (!Number.isInteger(repairSeconds) || repairSeconds < 60)
    )
      throw new Error("Repair interval must be blank or at least 60 seconds");
    return {
      workspaceId: props.workspaceId,
      repository: { owner: owner.trim(), name: repository.trim() },
      paused: view?.binding?.paused ?? false,
      checkEverySeconds: checkSeconds,
      repairEverySeconds: repairSeconds,
      agent: overrideAgent,
    };
  }

  function defaults(): PluginDefaults {
    return { automaticStarts, agent: defaultAgent };
  }

  const failure = error?.message ?? query.error?.message ?? null;
  const githubProblem = error
    ? error.githubProblem
    : settingsOpen
      ? null
      : (view?.health.githubProblem ?? null);
  const controlsDisabled = busy !== null || !view?.binding;
  const statusTone =
    view?.status === "error"
      ? props.theme.colors.statusDanger
      : view?.status === "paused"
        ? props.theme.colors.statusWarning
        : props.theme.colors.statusSuccess;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: props.theme.colors.surface0,
      }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: props.layout.compact ? 14 : 24,
          gap: 22,
          maxWidth: 1100,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ gap: 4 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Text
                style={{
                  color: props.theme.colors.foreground,
                  fontSize: 20,
                  fontWeight: "700",
                }}
              >
                Automatic agents
              </Text>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: statusTone,
                }}
              />
            </View>
            <Text style={{ color: props.theme.colors.foregroundMuted }}>
              {view?.binding
                ? `${view.binding.repository.owner}/${view.binding.repository.name}`
                : "Connect this workspace to a GitHub repository"}
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Action
              theme={props.theme}
              label={
                view?.binding?.paused ? "Resume workspace" : "Pause workspace"
              }
              disabled={controlsDisabled}
              onPress={() => {
                if (!view?.binding) return;
                perform("pause", async () => {
                  await setPause({
                    scope: "workspace",
                    workspaceId: props.workspaceId,
                    paused: !view.binding?.paused,
                  });
                  return undefined;
                });
              }}
            />
            <Action
              theme={props.theme}
              label={
                view?.defaults.automaticStarts ? "Pause all" : "Resume all"
              }
              disabled={busy !== null || !view}
              onPress={() => {
                if (!view) return;
                perform("pause", async () => {
                  await setPause({
                    scope: "all",
                    workspaceId: props.workspaceId,
                    paused: view.defaults.automaticStarts,
                  });
                  return undefined;
                });
              }}
            />
            <Action
              theme={props.theme}
              label={busy === "check" ? "Checking…" : "Check now"}
              disabled={controlsDisabled}
              onPress={() => {
                perform("check", () =>
                  checkNow({ workspaceId: props.workspaceId }).then(
                    (report) => {
                      setMessage(
                        report.errors > 0
                          ? null
                          : `${report.observed.toString()} observed · ${report.started.toString()} started · ${report.handled.toString()} already handled`,
                      );
                      return undefined;
                    },
                  ),
                );
              }}
            />
            <Action
              theme={props.theme}
              label="Settings"
              disabled={!view}
              onPress={openSettings}
            />
          </View>
        </View>

        {!settingsOpen && githubProblem ? (
          <AccessNotice
            theme={props.theme}
            problem={githubProblem}
            busy={busy !== null || view?.health.state === "checking"}
            onRetry={() => {
              if (!view?.binding) {
                setSettingsOpen(true);
                return;
              }
              perform("check", async () => {
                await checkNow({ workspaceId: props.workspaceId });
                return undefined;
              });
            }}
          />
        ) : !settingsOpen && failure ? (
          <Text
            accessibilityRole="alert"
            style={{ color: props.theme.colors.statusDanger }}
          >
            {failure}
          </Text>
        ) : null}
        {message ? (
          <Text style={{ color: props.theme.colors.statusSuccess }}>
            {message}
          </Text>
        ) : null}
        {!view ? (
          <Text style={{ color: props.theme.colors.foregroundMuted }}>
            Loading automation state…
          </Text>
        ) : null}

        {view ? (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[
                ["Ready", view.counts.ready],
                ["Building", view.counts.building],
                ["Reviewing", view.counts.reviewing],
                ["Merge queue", view.counts.mergeQueue],
                ["Needs you", view.counts.needsYou],
              ].map(([label, count]) => (
                <View
                  key={label}
                  style={{
                    flexGrow: 1,
                    minWidth: 110,
                    padding: 12,
                    gap: 4,
                    borderWidth: 1,
                    borderColor: props.theme.colors.border,
                    borderRadius: 8,
                    backgroundColor: props.theme.colors.surface1,
                  }}
                >
                  <Text
                    style={{
                      color: props.theme.colors.foregroundMuted,
                      fontSize: 12,
                    }}
                  >
                    {label}
                  </Text>
                  <Text
                    style={{
                      color: props.theme.colors.foreground,
                      fontSize: 22,
                      fontWeight: "600",
                    }}
                  >
                    {count}
                  </Text>
                </View>
              ))}
            </View>

            <Section theme={props.theme} title="Waiting on you">
              {view.attention.length === 0 ? (
                <Text style={{ color: props.theme.colors.foregroundMuted }}>
                  Nothing needs your attention.
                </Text>
              ) : (
                view.attention.map((item) => (
                  <Pressable
                    key={`${item.number.toString()}:${item.status}`}
                    accessibilityRole="link"
                    onPress={() =>
                      props.navigation?.openBrowser?.({
                        url: item.url,
                        workspaceId: props.workspaceId,
                      })
                    }
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      gap: 12,
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: props.theme.colors.border,
                    }}
                  >
                    <Text
                      style={{ color: props.theme.colors.foreground, flex: 1 }}
                    >
                      {item.title}
                    </Text>
                    <Text style={{ color: props.theme.colors.statusWarning }}>
                      {item.detail}
                    </Text>
                  </Pressable>
                ))
              )}
            </Section>

            <Section theme={props.theme} title="Recent activity">
              {view.activity.length === 0 ? (
                <Text style={{ color: props.theme.colors.foregroundMuted }}>
                  No signals observed yet.
                </Text>
              ) : (
                view.activity.map((item) => (
                  <View
                    key={item.id}
                    style={{
                      flexDirection: "row",
                      gap: 10,
                      alignItems: "baseline",
                      paddingVertical: 7,
                    }}
                  >
                    <Text
                      style={{
                        color:
                          item.kind === "error"
                            ? props.theme.colors.statusDanger
                            : item.kind === "started"
                              ? props.theme.colors.statusSuccess
                              : props.theme.colors.foregroundMuted,
                        minWidth: 58,
                        fontSize: 12,
                        textTransform: "uppercase",
                      }}
                    >
                      {item.kind}
                    </Text>
                    <Pressable
                      disabled={!item.url}
                      onPress={() => {
                        if (item.url)
                          props.navigation?.openBrowser?.({
                            url: item.url,
                            workspaceId: props.workspaceId,
                          });
                      }}
                      style={{ flex: 1 }}
                    >
                      <Text style={{ color: props.theme.colors.foreground }}>
                        {item.message}
                      </Text>
                    </Pressable>
                    <Text
                      style={{
                        color: props.theme.colors.foregroundMuted,
                        fontSize: 12,
                      }}
                    >
                      {relativeTime(item.at)}
                    </Text>
                  </View>
                ))
              )}
            </Section>

            <View
              style={{
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: props.theme.colors.border,
                flexDirection: "row",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Text
                style={{
                  color: props.theme.colors.foregroundMuted,
                  fontSize: 12,
                }}
              >
                {view.health.message} · checked{" "}
                {relativeTime(view.health.lastCheckedAt)}
              </Text>
              <Text
                style={{
                  color: props.theme.colors.foregroundMuted,
                  fontSize: 12,
                }}
              >
                Initial sync dispatches Ready work; older PR, CI, and comments
                are seeded.
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>

      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setSettingsOpen(false);
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.55)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 720,
              maxHeight: "92%",
              backgroundColor: props.theme.colors.surface0,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: props.theme.colors.border,
              overflow: "hidden",
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Text
                  style={{
                    color: props.theme.colors.foreground,
                    fontSize: 19,
                    fontWeight: "700",
                  }}
                >
                  Automatic agent settings
                </Text>
                <Action
                  theme={props.theme}
                  label="Close"
                  onPress={() => {
                    setSettingsOpen(false);
                  }}
                />
              </View>

              <Section theme={props.theme} title="GitHub repository">
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                >
                  <Input
                    theme={props.theme}
                    label="Owner"
                    value={owner}
                    placeholder="acme"
                    onChange={setOwner}
                  />
                  <Input
                    theme={props.theme}
                    label="Repository"
                    value={repository}
                    placeholder="product"
                    onChange={setRepository}
                  />
                </View>
                {githubProblem ? (
                  <AccessNotice
                    theme={props.theme}
                    problem={githubProblem}
                    busy={busy !== null}
                    onRetry={testGitHubConnection}
                  />
                ) : null}
              </Section>

              <Section theme={props.theme} title="Issue labels">
                <Text
                  style={{
                    color: props.theme.colors.foregroundMuted,
                    fontSize: 12,
                  }}
                >
                  Agents create these fixed stack labels when needed. The
                  watcher only reads them.
                </Text>
                <Text
                  style={{
                    color: props.theme.colors.foreground,
                    fontSize: 12,
                  }}
                >
                  stack:backlog · stack:ready · stack:in-progress ·
                  stack:in-review · stack:merge-queue · stack:hitl · stack:done
                </Text>
                <Text
                  style={{
                    color: props.theme.colors.foregroundMuted,
                    fontSize: 12,
                  }}
                >
                  Closed issues are excluded. Issues with conflicting workflow
                  labels appear under Waiting on you.
                </Text>
              </Section>

              <Section theme={props.theme} title="Agent provider and model">
                <Text
                  style={{
                    color: props.theme.colors.foregroundMuted,
                    fontSize: 12,
                  }}
                >
                  Plugin default
                </Text>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}
                >
                  {(view?.providerOptions ?? []).map((option) => (
                    <Choice
                      key={`${option.provider}:${option.model ?? "default"}`}
                      theme={props.theme}
                      label={option.label}
                      selected={
                        defaultAgent?.provider === option.provider &&
                        defaultAgent.model === option.model
                      }
                      disabled={!option.supportsWrite}
                      onPress={() => {
                        setDefaultAgent({
                          provider: option.provider,
                          model: option.model,
                        });
                      }}
                    />
                  ))}
                </View>
                <Text
                  style={{
                    color: props.theme.colors.foregroundMuted,
                    fontSize: 12,
                  }}
                >
                  This workspace
                </Text>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}
                >
                  <Choice
                    theme={props.theme}
                    label="Use plugin default"
                    selected={overrideAgent === null}
                    onPress={() => {
                      setOverrideAgent(null);
                    }}
                  />
                  {(view?.providerOptions ?? []).map((option) => (
                    <Choice
                      key={`${option.provider}:${option.model ?? "default"}`}
                      theme={props.theme}
                      label={option.label}
                      selected={
                        overrideAgent?.provider === option.provider &&
                        overrideAgent.model === option.model
                      }
                      disabled={!option.supportsWrite}
                      onPress={() => {
                        setOverrideAgent({
                          provider: option.provider,
                          model: option.model,
                        });
                      }}
                    />
                  ))}
                </View>
              </Section>

              <Section theme={props.theme} title="Schedule">
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}
                >
                  <Input
                    theme={props.theme}
                    label="Check every (seconds)"
                    value={checkEvery}
                    placeholder="60"
                    onChange={setCheckEvery}
                  />
                  <Input
                    theme={props.theme}
                    label="Repair every (seconds, blank disables)"
                    value={repairEvery}
                    placeholder="3600"
                    onChange={setRepairEvery}
                  />
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: props.theme.colors.foreground }}>
                      Automatic starts across all workspaces
                    </Text>
                    <Text
                      style={{
                        color: props.theme.colors.foregroundMuted,
                        fontSize: 12,
                      }}
                    >
                      Checks continue while starts are paused.
                    </Text>
                  </View>
                  <Switch
                    value={automaticStarts}
                    onValueChange={setAutomaticStarts}
                  />
                </View>
              </Section>

              {failure && !githubProblem ? (
                <Text
                  accessibilityRole="alert"
                  style={{ color: props.theme.colors.statusDanger }}
                >
                  {failure}
                </Text>
              ) : null}
              {message ? (
                <Text style={{ color: props.theme.colors.statusSuccess }}>
                  {message}
                </Text>
              ) : null}

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                  justifyContent: "space-between",
                }}
              >
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
                >
                  <Action
                    theme={props.theme}
                    label={busy === "test" ? "Testing…" : "Test connection"}
                    disabled={busy !== null}
                    onPress={testGitHubConnection}
                  />
                  {view?.binding ? (
                    <Action
                      theme={props.theme}
                      label="Remove binding"
                      danger
                      disabled={busy !== null}
                      onPress={() => {
                        perform("remove", () =>
                          saveSettings({
                            workspaceId: props.workspaceId,
                            defaults: defaults(),
                            binding: null,
                          }).then(() => {
                            setSettingsOpen(false);
                            return undefined;
                          }),
                        );
                      }}
                    />
                  ) : null}
                </View>
                <Action
                  theme={props.theme}
                  label={busy === "save" ? "Saving…" : "Save settings"}
                  primary
                  disabled={busy !== null}
                  onPress={() => {
                    perform("save", async () => {
                      await saveSettings({
                        workspaceId: props.workspaceId,
                        defaults: defaults(),
                        binding: selectedBinding(),
                      });
                      setSettingsOpen(false);
                      return undefined;
                    });
                  }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
