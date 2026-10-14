import type {
  PluginSurfaceProps,
  SettingsState,
} from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  Modal,
  ScrollView,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import type { SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import type { Settings } from "../shared/contracts";
import {
  remotesRpc,
  settingsDefinition,
  settingsSchema,
  tokenClearRpc,
  tokenSetRpc,
} from "../shared/contracts";
import { syncNowRpc } from "../shared/contracts";
import {
  copy as text,
  formatBytes,
  relativeTime,
  toneFor,
  useVaultStatus,
} from "./status";
import {
  ActionButton,
  Body,
  Headline,
  Hint,
  Notice,
  Status,
  Table,
} from "./ui";

type ReadySettings = Extract<
  SettingsState<typeof settingsSchema>,
  { status: "ready" }
>;

function describeTokenState(stored: boolean, account: string | null): string {
  if (!stored) return text.token.none;
  return account ? text.token.stored(account) : text.token.storedNoAccount;
}

function SettingsEditor({
  props,
  state,
}: {
  props: PluginSurfaceProps;
  state: ReadySettings;
}) {
  const { theme, layout } = props;
  const toast = useToast();
  const queries = useQueryClient();
  const status = useVaultStatus();
  const setToken = useRpc(tokenSetRpc);
  const clearToken = useRpc(tokenClearRpc);
  const syncNow = useRpc(syncNowRpc);
  const remotes = useRpc(remotesRpc);
  const tokenField = useRef<SettingsInputHandle | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [obPathDraft, setObPathDraft] = useState(state.values.obPath);
  const [savingToken, setSavingToken] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [pendingVault, setPendingVault] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const view = status.data;
  const saved = state.values;
  const remoteQuery = useQuery({
    queryKey: ["obsidian", "remotes", view?.token.stored ?? false],
    queryFn: () => remotes({}),
    enabled: view?.token.stored === true,
  });
  const remoteVaults =
    remoteQuery.data?.status === "ok" ? remoteQuery.data.vaults : [];
  const vaultOptions = [
    { label: text.vaultSelect.placeholder, value: "" },
    ...remoteVaults.map((vault) => ({ label: vault.name, value: vault.id })),
    ...(saved.vaultId &&
    saved.vaultName &&
    !remoteVaults.some((vault) => vault.id === saved.vaultId)
      ? [
          {
            label: `${saved.vaultName} (${text.vaultSelect.notFound})`,
            value: saved.vaultId,
          },
        ]
      : []),
  ];
  const apply = async (values: Settings) => {
    const ok = await state.save(values, state.revision);
    if (ok) toast.show(text.settingsSaved);
    else
      toast.error(text.settingsSaveError(state.saveError ?? "unknown error"));
  };
  const invalidate = async () => {
    await queries.invalidateQueries({ queryKey: ["obsidian"] });
  };
  const saveToken = async () => {
    const pasted = tokenDraft.trim();
    if (!pasted) return;
    setSavingToken(true);
    try {
      const result = await setToken({ token: pasted });
      if (result.status === "saved") {
        tokenField.current?.replaceText("");
        setTokenDraft("");
        setEditingToken(false);
        toast.show(text.toasts.tokenSaved(result.account));
      } else if (result.status === "rejected") {
        toast.error(text.toasts.tokenRejected);
      } else {
        toast.error(text.errors[result.code].body);
      }
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingToken(false);
    }
  };
  const removeToken = async () => {
    setConfirmingRemove(false);
    try {
      await clearToken({});
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const startSync = async () => {
    try {
      const result = await syncNow({});
      if (result.status === "started") toast.show(text.toasts.syncStarted);
      else if (result.status === "already_pulling")
        toast.show(text.toasts.syncBusy);
      else toast.error(text.errors.ob_missing.body);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    if (editingToken) tokenField.current?.focus();
  }, [editingToken]);
  const banner = view?.error ? text.errors[view.error.code] : null;
  const instructions = view?.injection;

  return (
    <ScrollView
      contentContainerStyle={{
        padding: layout.compact ? 12 : 24,
        gap: 12,
        backgroundColor: theme.colors.surface0,
      }}
      style={{ flex: 1 }}
    >
      <View style={{ gap: 12 }}>
        <Headline theme={theme}>{text.title}</Headline>
        {view ? (
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
              tone={toneFor(view.state)}
              label={text.state[view.state]}
            />
            <Hint theme={theme}>
              {`${text.lastSync}: ${relativeTime(view.lastSuccessAt)}`}
            </Hint>
          </View>
        ) : null}
        {banner ? (
          <Notice theme={theme} tone="danger" title={banner.title}>
            <Body theme={theme}>{banner.body}</Body>
            <Hint theme={theme}>{`Action: ${banner.action}.`}</Hint>
          </Notice>
        ) : null}
        {status.isError ? (
          <Notice theme={theme} tone="danger" title={text.unknown}>
            <Body theme={theme}>{text.statusReadError(props.host.label)}</Body>
            <ActionButton
              theme={theme}
              layout={layout}
              label={text.reload}
              onPress={() => {
                status.refetch().catch(console.error);
              }}
            />
          </Notice>
        ) : null}
      </View>

      {view?.state === "unconfigured" ? (
        <SettingsSection title={text.setupHeading}>
          <SettingsCard>
            {text
              .checklist(
                view.token.stored,
                view.ob.path !== null,
                view.vault !== null,
                view.lastSuccessAt != null,
              )
              .map((row) => (
                <SettingsRow key={row.label} label={row.label}>
                  <Body theme={theme} muted={!row.done}>
                    {row.done ? text.done : text.todo}
                  </Body>
                </SettingsRow>
              ))}
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title={text.sections.connection}>
        <SettingsCard>
          <SettingsRow label={text.token.label}>
            <Body theme={theme} muted>
              {describeTokenState(
                view?.token.stored ?? false,
                view?.token.account ?? null,
              )}
            </Body>
          </SettingsRow>
          {editingToken ? (
            <>
              <SettingsInput
                ref={tokenField}
                label=""
                placeholder={text.token.placeholder}
                secureTextEntry
                disabled={savingToken}
                onChangeText={setTokenDraft}
              />
              <SettingsRow label="">
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <ActionButton
                    theme={theme}
                    layout={layout}
                    variant="primary"
                    label={savingToken ? text.saving : text.saveToken}
                    disabled={savingToken || tokenDraft.trim() === ""}
                    onPress={() => {
                      saveToken().catch(console.error);
                    }}
                  />
                  <ActionButton
                    theme={theme}
                    layout={layout}
                    variant="ghost"
                    label={text.confirm.cancel}
                    disabled={savingToken}
                    onPress={() => {
                      tokenField.current?.replaceText("");
                      setTokenDraft("");
                      setEditingToken(false);
                    }}
                  />
                </View>
              </SettingsRow>
            </>
          ) : (
            <SettingsRow label="">
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionButton
                  theme={theme}
                  layout={layout}
                  variant={view?.token.stored ? "secondary" : "primary"}
                  label={view?.token.stored ? text.replaceToken : text.addToken}
                  onPress={() => {
                    setEditingToken(true);
                  }}
                />
                {view?.token.stored ? (
                  <ActionButton
                    theme={theme}
                    layout={layout}
                    variant="ghost"
                    label={text.removeToken}
                    onPress={() => {
                      setConfirmingRemove(true);
                    }}
                  />
                ) : null}
              </View>
            </SettingsRow>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={text.sections.cli}>
        <SettingsCard>
          <SettingsRow label={text.cli.label}>
            <View style={{ gap: 4 }}>
              <Body theme={theme} muted>
                {view?.ob.path
                  ? text.cli.found(view.ob.path)
                  : text.cli.notFound}
              </Body>
              {view?.ob.version ? (
                <Hint theme={theme}>
                  {`ob ${view.ob.version}, ${text.cli.minimum} ${view.ob.minVersion}`}
                </Hint>
              ) : null}
            </View>
          </SettingsRow>
          {status.isLoading || view?.ob.source === "path" ? null : (
            <>
              <SettingsInput
                label=""
                placeholder={text.cli.placeholder}
                initialValue={saved.obPath}
                onChangeText={(value) => {
                  setObPathDraft(value);
                }}
              />
              <SettingsAction
                label=""
                actionLabel={text.cli.save}
                disabled={obPathDraft === saved.obPath}
                onPress={() => {
                  apply({ ...saved, obPath: obPathDraft }).catch(console.error);
                }}
              />
            </>
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={text.sections.vault}>
        <SettingsCard>
          <SettingsSelect
            label={text.vaultSelect.label}
            value={saved.vaultId ?? ""}
            disabled={!view?.token.stored}
            options={vaultOptions}
            onValueChange={(value) => {
              const vault = vaultOptions.find(
                (option) => option.value === value,
              );
              if (!vault) return;
              const next = {
                id: value,
                name: vault.label.replace(/ \(.*\)$/, ""),
              };
              if (saved.vaultId && saved.vaultId !== value) {
                setPendingVault(next);
                return;
              }
              apply({
                ...saved,
                vaultId: value || null,
                vaultName: value ? next.name : null,
              }).catch(console.error);
            }}
          />
          <SettingsAction
            label=""
            actionLabel={text.syncNow}
            disabled={!view?.vault || view.pulling}
            onPress={() => {
              startSync().catch(console.error);
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={text.sections.instructions}>
        <SettingsCard>
          {instructions ? (
            <View style={{ gap: 6 }}>
              <Table
                theme={theme}
                layout={layout}
                columns={[
                  {
                    key: "path",
                    label: text.skillColumns.path,
                    flex: 3,
                    kind: "mono",
                  },
                  {
                    key: "status",
                    label: text.skillColumns.status,
                    width: 140,
                  },
                  {
                    key: "size",
                    label: text.skillColumns.size,
                    width: 80,
                    align: "right",
                    kind: "mono",
                  },
                ]}
                rows={instructions.skills.map((skill) => ({
                  key: skill.path,
                  cells: [
                    skill.path,
                    describeInjection(skill.status),
                    formatBytes(skill.bytes),
                  ],
                }))}
              />
              {instructions.skills.length === 0 ? (
                <Hint theme={theme}>{text.skillsNone}</Hint>
              ) : null}
            </View>
          ) : (
            <Hint theme={theme}>{text.settingsLoading}</Hint>
          )}
        </SettingsCard>
      </SettingsSection>

      <Modal
        title={text.confirm.removeTitle}
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
      >
        <Modal.Content>
          <View style={{ gap: 12 }}>
            <Body theme={theme}>
              {text.confirm.removeBody(saved.vaultName ?? text.vault)}
            </Body>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionButton
                theme={theme}
                layout={layout}
                label={text.confirm.cancel}
                onPress={() => {
                  setConfirmingRemove(false);
                }}
              />
              <ActionButton
                theme={theme}
                layout={layout}
                variant="danger"
                label={text.confirm.remove}
                onPress={() => {
                  removeToken().catch(console.error);
                }}
              />
            </View>
          </View>
        </Modal.Content>
      </Modal>

      <Modal
        title={text.confirm.switchTitle}
        open={pendingVault !== null}
        onOpenChange={(open) => {
          if (!open) setPendingVault(null);
        }}
      >
        <Modal.Content>
          <View style={{ gap: 12 }}>
            <Body theme={theme}>
              {text.confirm.switchBody(
                saved.vaultName ?? text.vault,
                pendingVault?.name ?? "",
              )}
            </Body>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ActionButton
                theme={theme}
                layout={layout}
                label={text.confirm.cancel}
                onPress={() => {
                  setPendingVault(null);
                }}
              />
              <ActionButton
                theme={theme}
                layout={layout}
                variant="primary"
                label={text.switchVault}
                onPress={() => {
                  const next = pendingVault;
                  setPendingVault(null);
                  if (next)
                    apply({
                      ...saved,
                      vaultId: next.id,
                      vaultName: next.name,
                    }).catch(console.error);
                }}
              />
            </View>
          </View>
        </Modal.Content>
      </Modal>
    </ScrollView>
  );
}

function describeInjection(
  status: "injected" | "not_injected" | "truncated",
): string {
  if (status === "injected") return text.status.injected;
  if (status === "truncated") return text.status.truncated;
  return text.status.skipped;
}

export function SettingsScreen(props: PluginSurfaceProps) {
  const state = useSettings(settingsDefinition);
  if (state.status === "ready")
    return <SettingsEditor key={state.revision} props={props} state={state} />;
  return (
    <ScrollView
      contentContainerStyle={{
        padding: props.layout.compact ? 12 : 24,
        gap: 12,
        backgroundColor: props.theme.colors.surface0,
      }}
      style={{ flex: 1 }}
    >
      {state.status === "loading" ? (
        <Hint theme={props.theme}>{text.settingsLoading}</Hint>
      ) : (
        <Notice theme={props.theme} tone="danger" title={text.unknown}>
          <Body theme={props.theme}>
            {state.status === "invalid"
              ? text.settingsInvalid(state.error)
              : text.settingsReadError(state.error)}
          </Body>
        </Notice>
      )}
      {state.status !== "loading" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <ActionButton
            theme={props.theme}
            layout={props.layout}
            label={text.reload}
            onPress={() => {
              state.reload().catch(console.error);
            }}
          />
          {state.status === "invalid" ? (
            <ActionButton
              theme={props.theme}
              layout={props.layout}
              variant="danger"
              label={text.reset}
              onPress={() => {
                state.reset().catch(console.error);
              }}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}
