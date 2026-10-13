import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { cancelRpc, statusRpc, submitRpc } from "../shared/contracts";
import type {
  HandoffResult,
  ResolvedStatus,
  SecretRequest,
} from "../shared/protocol";

type Props = PluginTimelineItemProps<SecretRequest>;

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

type ViewState = "form" | "delivered" | "canceled" | "gone" | "unavailable";

type Busy = "send" | "cancel" | null;

type CancelResult = { status: ResolvedStatus; message: string | null };

type Notice = { message: string };

type Copy = {
  headline: {
    pending: string;
    sending: string;
    delivered: string;
    canceled: string;
    gone: string;
    unavailable: string;
  };
  field: {
    label: string;
    note: string;
    placeholder: string;
    a11yLabel: (label: string) => string;
  };
  meta: { wait: (minutes: number) => string };
  action: {
    send: string;
    sending: string;
    cancel: string;
  };
  idle: string;
  delivered: {
    noteBefore: string;
    noteAfter: string;
    noDeadline: string;
    path: string;
  };
  unavailable: { title: string; fallback: string };
  offline: string;
  error: { generic: string };
  a11y: { card: (label: string) => string };
};

const IDLE_MS = 5 * 60_000;
const CLOCK_MS = 30_000;
const POLL_MS = 5_000;

const en: Copy = {
  headline: {
    pending: "Secret requested",
    sending: "Sending secret…",
    delivered: "Secret delivered",
    canceled: "Request canceled",
    gone: "Request interrupted",
    unavailable: "Cannot hand over the value",
  },
  field: {
    label: "Value",
    note: "Typed text is hidden and never added to the chat.",
    placeholder: "Paste or type the value",
    a11yLabel: (label) => `Secret value for ${label}`,
  },
  meta: { wait: (minutes) => `Waiting ${String(minutes)} min` },
  action: {
    send: "Send to agent",
    sending: "Sending…",
    cancel: "Cancel",
  },
  idle: "Cleared after inactivity. Type it again.",
  delivered: {
    noteBefore:
      "Passed to your agent; held in RAM only on a tmpfs file deleted automatically by ",
    noteAfter: ".",
    noDeadline:
      "Passed to your agent; held in RAM only on a tmpfs file that is deleted automatically.",
    path: "The agent receives a file path it can read, not the value.",
  },
  unavailable: {
    title: "The value could not be handed over safely",
    fallback: "The value was not sent and was not stored.",
  },
  offline: "Paseo is offline. Reconnect to send.",
  error: { generic: "The value could not be sent. Your input is kept." },
  a11y: { card: (label) => `Secret request: ${label}` },
};

const zh: Copy = {
  headline: {
    pending: "需要提供密钥",
    sending: "正在发送密钥…",
    delivered: "密钥已交付",
    canceled: "请求已取消",
    gone: "请求已中断",
    unavailable: "无法交接密钥",
  },
  field: {
    label: "值",
    note: "输入内容已隐藏，不会加入聊天记录。",
    placeholder: "粘贴或输入该值",
    a11yLabel: (label) => `${label} 的密钥值`,
  },
  meta: { wait: (minutes) => `已等待 ${String(minutes)} 分钟` },
  action: {
    send: "发送给 Bot",
    sending: "发送中…",
    cancel: "取消",
  },
  idle: "因长时间未操作已清空。请重新输入。",
  delivered: {
    noteBefore: "已安全传递给你的 Bot，仅存于内存盘，将于 ",
    noteAfter: " 前自动清除。",
    noDeadline: "已安全传递给你的 Bot，仅存于内存盘，会自动清除。",
    path: "Bot 收到的是可读取的文件路径，而不是值本身。",
  },
  unavailable: {
    title: "无法安全交接该值",
    fallback: "未发送，也未保存该值。",
  },
  offline: "Paseo 已离线。重新连接后即可发送。",
  error: { generic: "无法发送，输入内容已保留。" },
  a11y: { card: (label) => `密钥请求：${label}` },
};

function detectLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return "en";
  }
}

const LOCALE = detectLocale();

export const copy: Copy = LOCALE.toLowerCase().startsWith("zh") ? zh : en;

const toneColors = {
  neutral: "foregroundMuted",
  accent: "accent",
  success: "statusSuccess",
  warning: "statusWarning",
  danger: "statusDanger",
} as const satisfies Record<Tone, keyof PluginTheme["colors"]>;

const NETWORK_ERROR =
  /network|offline|fetch|disconnect|timeout|timed out|econn|socket|unreachable|connection/i;

const deadlineFormat = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
});

function formatDeadline(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? "" : deadlineFormat.format(at);
}

function resolveView(status: ResolvedStatus): ViewState {
  switch (status) {
    case "pending":
      return "form";
    case "delivered":
      return "delivered";
    case "canceled":
      return "canceled";
    case "gone":
      return "gone";
    case "unavailable":
      return "unavailable";
  }
}

function headline(view: ViewState, sending: boolean): string {
  switch (view) {
    case "form":
      return sending ? copy.headline.sending : copy.headline.pending;
    case "delivered":
      return copy.headline.delivered;
    case "canceled":
      return copy.headline.canceled;
    case "gone":
      return copy.headline.gone;
    case "unavailable":
      return copy.headline.unavailable;
  }
}

function viewTone(view: ViewState): Tone {
  switch (view) {
    case "form":
      return "accent";
    case "delivered":
      return "success";
    case "canceled":
    case "gone":
      return "neutral";
    case "unavailable":
      return "danger";
  }
}

function makeStyles(
  theme: PluginTheme,
  compact: boolean,
  platform: "ios" | "android" | "web",
) {
  const colors = theme.colors;
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      gap: 12,
      width: "100%",
      maxWidth: compact ? undefined : 560,
      padding: compact ? 12 : 16,
      borderWidth: 1,
      borderRadius: 12,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
    },
    rule: { width: 3, borderRadius: 2 },
    column: { flex: 1, minWidth: 0, gap: 12 },
    stack: { gap: 6 },
    meta: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
    },
    headline: {
      color: colors.foreground,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "600",
    },
    label: {
      color: colors.foreground,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },
    body: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
    muted: { color: colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    mono: {
      color: colors.foregroundMuted,
      fontFamily: platform === "ios" ? "Menlo" : "monospace",
      fontSize: 12,
      lineHeight: 17,
      flexShrink: 1,
    },
    field: { gap: 6 },
    input: {
      color: colors.foreground,
      fontSize: 16,
      minHeight: compact ? 48 : 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      borderRadius: 6,
    },
    inputFocused: { borderColor: colors.accent },
    actions: {
      flexDirection: compact ? "column-reverse" : "row",
      justifyContent: "flex-end",
      alignItems: compact ? "stretch" : "center",
      gap: 8,
    },
    button: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
    },
    buttonContent: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    primary: { backgroundColor: colors.accent },
    primaryText: {
      color: colors.accentForeground,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "600",
    },
    secondary: {
      backgroundColor: colors.surface1,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryText: {
      color: colors.foreground,
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
    },
    banner: {
      backgroundColor: colors.surface1,
      borderLeftWidth: 3,
      borderRadius: 8,
      padding: 12,
      gap: 8,
    },
  });
}

function Banner({
  banner,
  color,
  role,
  children,
}: {
  banner: StyleProp<ViewStyle>;
  color: string;
  role?: "alert";
  children: ReactNode;
}) {
  return (
    <View accessibilityRole={role} style={[banner, { borderLeftColor: color }]}>
      {children}
    </View>
  );
}

export function SecretRequestCard({ agentId, item, theme, layout }: Props) {
  const { requestId, label, description, hint, createdAt } = item.data;
  const readStatus = useRpc(statusRpc);
  const submit = useRpc(submitRpc);
  const cancel = useRpc(cancelRpc);
  const inputRef = useRef<TextInput>(null);
  const buffer = useRef("");
  const lastInput = useRef(Date.now());
  const [status, setStatus] = useState<ResolvedStatus>(item.data.status);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [handoffExpiresAt, setHandoffExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [offline, setOffline] = useState(false);
  const [hasText, setHasText] = useState(false);
  const [idleCleared, setIdleCleared] = useState(false);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const view = resolveView(status);
  const sending = busy === "send";

  const styles = useMemo(
    () => makeStyles(theme, layout.compact, layout.platform),
    [theme, layout.compact, layout.platform],
  );

  const clearBuffer = useCallback(() => {
    buffer.current = "";
    inputRef.current?.clear();
    setHasText(false);
  }, []);

  const syncStatus = useCallback(() => {
    readStatus({ agentId, requestId })
      .then((result) => {
        setOffline(false);
        if (result.status !== "pending") {
          clearBuffer();
          setNotice(null);
        }
        setStatus(result.status);
        setStatusMessage(null);
        setHandoffExpiresAt(result.handoffExpiresAt);
      })
      .catch(() => {
        setOffline(true);
      });
  }, [readStatus, agentId, requestId, clearBuffer]);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, CLOCK_MS);
    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (view !== "form") return;
    const id = setInterval(() => {
      syncStatus();
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [view, syncStatus]);

  useEffect(() => {
    if (view !== "form") return;
    const id = setInterval(() => {
      if (
        buffer.current.length > 0 &&
        Date.now() - lastInput.current >= IDLE_MS
      ) {
        clearBuffer();
        setIdleCleared(true);
      }
    }, CLOCK_MS);
    return () => {
      clearInterval(id);
    };
  }, [view, clearBuffer]);

  useEffect(() => {
    if (item.data.status === "pending") return;
    syncStatus();
  }, [item.data.status, syncStatus]);

  useEffect(
    () => () => {
      buffer.current = "";
    },
    [],
  );

  const applySubmit = (result: HandoffResult) => {
    switch (result.status) {
      case "delivered":
        clearBuffer();
        setNotice(null);
        setStatusMessage(null);
        setStatus("delivered");
        setHandoffExpiresAt(result.handoffExpiresAt);
        return;
      case "canceled":
        clearBuffer();
        setNotice(null);
        setStatusMessage(null);
        setStatus("canceled");
        return;
      case "gone":
        clearBuffer();
        setNotice(null);
        setStatusMessage(null);
        setStatus("gone");
        return;
      case "unavailable":
        clearBuffer();
        setNotice(null);
        setStatusMessage(result.message);
        setStatus("unavailable");
        return;
      case "pending":
        setNotice(null);
        syncStatus();
        return;
    }
  };

  const applyCancel = (result: CancelResult) => {
    switch (result.status) {
      case "canceled":
        clearBuffer();
        setNotice(null);
        setStatusMessage(null);
        setStatus("canceled");
        return;
      case "delivered":
        clearBuffer();
        setNotice(null);
        setStatusMessage(null);
        setStatus("delivered");
        syncStatus();
        return;
      case "gone":
        clearBuffer();
        setNotice(null);
        setStatusMessage(null);
        setStatus("gone");
        return;
      case "unavailable":
        clearBuffer();
        setNotice(null);
        setStatusMessage(result.message);
        setStatus("unavailable");
        return;
      case "pending":
        setNotice(null);
        syncStatus();
        return;
    }
  };

  const declareFailure = (error: unknown) => {
    if (!(error instanceof Error) || NETWORK_ERROR.test(error.message)) {
      setOffline(true);
    } else {
      setNotice({
        message: error.message.length > 0 ? error.message : copy.error.generic,
      });
    }
    syncStatus();
  };

  const onChangeText = (text: string) => {
    buffer.current = text;
    lastInput.current = Date.now();
    const trimmed = text.trim();
    setIdleCleared(false);
    setHasText(trimmed.length > 0);
  };

  const onSend = () => {
    if (busy !== null || buffer.current.trim().length === 0) return;
    setNotice(null);
    setBusy("send");
    const value = buffer.current.trim();
    submit({ agentId, requestId, value })
      .then((result) => {
        setBusy(null);
        applySubmit(result);
      })
      .catch((error: unknown) => {
        setBusy(null);
        declareFailure(error);
      });
  };

  const onCancel = () => {
    if (busy !== null) return;
    setNotice(null);
    setBusy("cancel");
    cancel({ agentId, requestId })
      .then((result) => {
        setBusy(null);
        applyCancel(result);
      })
      .catch((error: unknown) => {
        setBusy(null);
        declareFailure(error);
      });
  };

  const minutesWaiting = Math.max(
    0,
    Math.floor((now - Date.parse(createdAt)) / 60_000),
  );
  const tone: Tone =
    view === "unavailable" || notice !== null
      ? "danger"
      : offline
        ? "warning"
        : viewTone(view);
  const toneColor = (value: Tone) => theme.colors[toneColors[value]];
  const disabled = busy !== null || offline;
  const sendDisabled = disabled || !hasText;

  return (
    <View
      testID="secret-request-card"
      accessibilityLabel={copy.a11y.card(label)}
      style={styles.card}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.rule, { backgroundColor: toneColor(tone) }]}
      />
      <View style={styles.column}>
        <View style={styles.stack}>
          <View testID="secret-request-status">
            <Text
              testID="secret-request-headline"
              accessibilityLiveRegion="polite"
              style={styles.headline}
            >
              {headline(view, sending)}
            </Text>
          </View>
          <Text
            testID="secret-request-label"
            accessibilityRole="header"
            style={styles.label}
          >
            {label}
          </Text>
          {description ? (
            <Text testID="secret-request-description" style={styles.body}>
              {description}
            </Text>
          ) : null}
          {hint ? (
            <Text testID="secret-request-hint" style={styles.body}>
              {hint}
            </Text>
          ) : null}
        </View>
        <View style={styles.meta}>
          <Text selectable testID="secret-request-id" style={styles.mono}>
            {requestId}
          </Text>
          {view === "form" ? (
            <Text testID="secret-request-wait" style={styles.muted}>
              {copy.meta.wait(minutesWaiting)}
            </Text>
          ) : null}
        </View>
        {view === "form" ? (
          <View style={styles.field}>
            <Text style={styles.body}>{copy.field.label}</Text>
            <TextInput
              ref={inputRef}
              testID="secret-request-input"
              accessibilityLabel={copy.field.a11yLabel(label)}
              placeholder={copy.field.placeholder}
              placeholderTextColor={theme.colors.foregroundMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              textContentType="none"
              importantForAutofill="no"
              editable={busy === null}
              returnKeyType="done"
              onChangeText={onChangeText}
              onSubmitEditing={onSend}
              onFocus={() => {
                setFocused(true);
              }}
              onBlur={() => {
                setFocused(false);
              }}
              style={[styles.input, focused ? styles.inputFocused : null]}
            />
            {idleCleared ? (
              <Text testID="secret-request-idle" style={styles.muted}>
                {copy.idle}
              </Text>
            ) : null}
            <Text testID="secret-request-field-note" style={styles.muted}>
              {copy.field.note}
            </Text>
            <View style={styles.actions}>
              <Pressable
                testID="secret-request-cancel"
                accessibilityRole="button"
                accessibilityLabel={copy.action.cancel}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={onCancel}
                style={({ pressed }) => [
                  styles.button,
                  styles.secondary,
                  { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={styles.secondaryText}>{copy.action.cancel}</Text>
              </Pressable>
              <Pressable
                testID="secret-request-submit"
                accessibilityRole="button"
                accessibilityLabel={
                  sending ? copy.action.sending : copy.action.send
                }
                accessibilityState={{ disabled: sendDisabled, busy: sending }}
                disabled={sendDisabled}
                onPress={onSend}
                style={({ pressed }) => [
                  styles.button,
                  styles.primary,
                  { opacity: sendDisabled ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                <View style={styles.buttonContent}>
                  {sending ? (
                    <ActivityIndicator
                      testID="secret-request-spinner"
                      color={theme.colors.accentForeground}
                    />
                  ) : null}
                  <Text style={styles.primaryText}>
                    {sending ? copy.action.sending : copy.action.send}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        ) : null}
        {view === "delivered" ? (
          <View style={styles.stack}>
            <Text
              testID="secret-request-delivered"
              accessibilityLiveRegion="polite"
              style={[styles.body, { color: toneColor("success") }]}
            >
              {handoffExpiresAt === null
                ? copy.delivered.noDeadline
                : `${copy.delivered.noteBefore}${formatDeadline(handoffExpiresAt)}${copy.delivered.noteAfter}`}
            </Text>
            <Text testID="secret-request-delivered-note" style={styles.muted}>
              {copy.delivered.path}
            </Text>
          </View>
        ) : null}
        {view === "unavailable" ? (
          <Banner
            banner={styles.banner}
            color={toneColor("danger")}
            role="alert"
          >
            <Text testID="secret-request-unavailable" style={styles.label}>
              {copy.unavailable.title}
            </Text>
            <Text
              testID="secret-request-unavailable-message"
              style={styles.body}
            >
              {statusMessage ?? copy.unavailable.fallback}
            </Text>
          </Banner>
        ) : null}
        {view === "form" && notice !== null ? (
          <Banner
            banner={styles.banner}
            color={toneColor("danger")}
            role="alert"
          >
            <Text testID="secret-request-error" style={styles.body}>
              {notice.message}
            </Text>
          </Banner>
        ) : null}
        {offline ? (
          <Banner banner={styles.banner} color={toneColor("warning")}>
            <Text testID="secret-request-offline" style={styles.body}>
              {copy.offline}
            </Text>
          </Banner>
        ) : null}
      </View>
    </View>
  );
}
