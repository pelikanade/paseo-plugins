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
import { copy as text, relativeTime, toneFor, useVaultStatus } from "./status";
import {
  ActionButton,
  Body,
  ErrorNotice,
  Headline,
  Hint,
  Notice,
  Status,
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
  const [pickingVault, setPickingVault] = useState(false);
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
  const vaultValue = saved.vaultName
    ? remoteVaults.some((vault) => vault.id === saved.vaultId)
      ? saved.vaultName
      : `${saved.vaultName} (${text.vaultSelect.notFound})`
    : text.vaultSelect.none;
  const selectVault = (option: { label: string; value: string }) => {
    setPickingVault(false);
    const next = {
      id: option.value,
      name: option.label.replace(/ \(.*\)$/, ""),
    };
    if (saved.vaultId && saved.vaultId !== option.value) {
      setPendingVault(next);
      return;
    }
    apply({
      ...saved,
      vaultId: option.value,
      vaultName: next.name,
    }).catch(console.error);
  };
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
        if (saved.vaultId === null) setPickingVault(true);
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
      else toast.show(text.toasts.syncUnconfigured);
      await invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    if (editingToken) tokenField.current?.focus();
  }, [editingToken]);
  const banner = view?.error ? text.errors[view.error.code] : null;

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
          <ErrorNotice
            theme={theme}
            title={banner.title}
            body={banner.body}
            action={banner.action}
          />
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

      <SettingsSection title={text.sections.connection}>
        <SettingsCard>
          <SettingsRow label={text.token.label}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <Body theme={theme} muted>
                {describeTokenState(
                  view?.token.stored ?? false,
                  view?.token.account ?? null,
                )}
              </Body>
              <ActionButton
                theme={theme}
                layout={layout}
                variant={view?.token.stored ? "secondary" : "primary"}
                label={view?.token.stored ? text.changeToken : text.addToken}
                disabled={status.isLoading}
                onPress={() => {
                  setEditingToken(true);
                }}
              />
            </View>
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
                <View
                  style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                >
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
                  {view?.token.stored ? (
                    <ActionButton
                      theme={theme}
                      layout={layout}
                      variant="ghost"
                      label={text.removeToken}
                      disabled={savingToken}
                      onPress={() => {
                        setConfirmingRemove(true);
                      }}
                    />
                  ) : null}
                </View>
              </SettingsRow>
            </>
          ) : null}
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

      {saved.vaultId !== null || view?.token.stored === true ? (
        <SettingsSection title={text.sections.vault}>
          <SettingsCard>
            <SettingsRow label={text.vaultSelect.label}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <Body theme={theme} muted>
                  {vaultValue}
                </Body>
                <ActionButton
                  theme={theme}
                  layout={layout}
                  variant="secondary"
                  label={
                    saved.vaultId
                      ? text.vaultSelect.change
                      : text.vaultSelect.choose
                  }
                  disabled={status.isLoading}
                  onPress={() => {
                    setPickingVault(true);
                  }}
                />
                {saved.vaultId ? (
                  <ActionButton
                    theme={theme}
                    layout={layout}
                    variant="secondary"
                    label={text.syncNow}
                    disabled={Boolean(view?.pulling)}
                    onPress={() => {
                      startSync().catch(console.error);
                    }}
                  />
                ) : null}
              </View>
            </SettingsRow>
            <Modal
              title={text.vaultSelect.label}
              open={pickingVault}
              onOpenChange={setPickingVault}
            >
              <Modal.Content>
                <View style={{ gap: 8 }}>
                  {remoteQuery.isPending ? (
                    <Hint theme={theme}>{text.loadingVaults}</Hint>
                  ) : null}
                  {remoteQuery.data?.status === "error" ? (
                    <Hint theme={theme}>
                      {text.errors[remoteQuery.data.code].title}
                    </Hint>
                  ) : null}
                  {remoteQuery.data?.status === "token_missing" ? (
                    <Hint theme={theme}>{text.token.none}</Hint>
                  ) : null}
                  {remoteQuery.data?.status === "ok" &&
                  remoteQuery.data.vaults.length === 0 ? (
                    <Hint theme={theme}>{text.noRemoteVaults}</Hint>
                  ) : null}
                  {vaultOptions.map((option) => (
                    <ActionButton
                      key={option.value}
                      theme={theme}
                      layout={layout}
                      variant={
                        option.value === (saved.vaultId ?? "")
                          ? "primary"
                          : "secondary"
                      }
                      label={option.label}
                      onPress={() => {
                        selectVault(option);
                      }}
                    />
                  ))}
                  <ActionButton
                    theme={theme}
                    layout={layout}
                    variant="ghost"
                    label={text.confirm.cancel}
                    onPress={() => {
                      setPickingVault(false);
                    }}
                  />
                </View>
              </Modal.Content>
            </Modal>
          </SettingsCard>
        </SettingsSection>
      ) : null}

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
