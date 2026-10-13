# Secret request card: UI specification

Plugin: `secret-request` (`plugins/secret-request`). Component: `SecretRequestCard`, rendered by the host for `item.kind === "secret-request"`, `version: 1`.

Model: one request, one answer. The `request_secret` tool call blocks until the user sends the value or cancels. Requests do not expire. On send, the daemon writes the value once to a `0600` file at `/dev/shm/paseo-<uid>-secret-request/<requestId>`, a RAM-backed mount. The blocked call returns `{status:"delivered", path, handoffExpiresAt}`. The tool result carries the path, never the value. The agent receives a file path it can read, and the file is deleted 15 minutes after delivery. Only `state.json` (MCP port and agent tokens, no secrets) lives under `PASEO_HOME`. Nothing is stored, granted, replaced or reused.

Visual language follows the devenv plugin: `Notice`-style tone bar, `surface1` card, `surface2` field, 44px touch targets on native.

## 1. Interaction model

Principles:

- One-shot. No state survives beyond `data` and the typed buffer. No vault, no reuse, no replace, no re-entry of an earlier value.
- `data.status` is the source of truth. Local state holds only the typed buffer (in a ref, never in state) and a card-local `phase` (`editing`, `sending`, `rpcError`, `unavailable`), plus `hint`, `hasText`, `emptyRejected` and `idleCleared`. `offline` and `gone` are derived from the status query.
- Terminal: `delivered`, `canceled`, `gone`, and the card-local `unavailable`. None returns to input.
- The tool call waits without a time limit. Requests never expire. The card shows elapsed wait in minutes and never says or implies the agent timed out or gave up.
- Value rules: trim leading and trailing spaces on send. Interior spaces are kept. Newlines cannot be entered (section 5). Only an empty send is blocking. Length and format checks are hints.

Lifecycle:

1. **Request.** Agent calls `request_secret({label, description?, hint?, expectedLength?})`. The daemon creates a pending request (`requestId`, `createdAt`) and the call blocks. The card shows label, description, hint, request id, elapsed wait, and "The request does not expire. The agent waits for your answer." The input is auto-focused only if this card is the newest timeline item and the user has not scrolled away.
2. **Type or paste.** The field is masked. Hints update on every change. Hints never contain the value. Length is compared only as a boolean against `expectedLength`.
3. **Send.** Send calls `secrets.submit({agentId, requestId, value})` with `value = input.trim()`. Input and Send go busy while the call is in flight, so one tap sends one value. There is no automatic retry. The server decides by the request's state:

- Pending: writes the file once and returns `{status:"delivered", handoffExpiresAt}`.
- Already delivered: returns the same `{status:"delivered", handoffExpiresAt}` again and writes no second file. A lost response recovers this way.
- Canceled: fails with error code `request-canceled`.
- Unknown to the server (plugin reloaded or daemon restarted): fails with error code `request-gone`.
- Handoff root unusable: returns `{status:"unavailable", message}` (step 11).
  Terminal errors resolve the card through a status read (step 10).

4. **Delivered.** The blocked call returns `{status:"delivered", path, handoffExpiresAt}` to the agent. The card clears the buffer, removes the input, and shows the note, a live countdown to `handoffExpiresAt`, and "the agent receives a file path it can read, not the value".
5. **Cancel.** Cancel calls `secrets.cancel`. The buffer is cleared only after the call succeeds, so a failed cancel keeps the text. The blocked call resolves with `{status:"canceled"}`, so the agent learns the user declined. No confirmation dialog: cancel is the decline path.
6. **Ignore.** A pending card stays pending until the user answers. Nothing is auto-sent or auto-canceled, and the card sends no reminders. A 1-second clock drives the wait line, the handoff countdown and the idle timer.
7. **Gone.** When a status read or submit fails with `request-gone` (the plugin reloaded or the daemon restarted), the card shows the `gone` state: a muted terminal line, no input, no retry. The card reports only what the server returned and does not claim the agent is still waiting.
8. **Paste.** Always allowed. Newlines cannot be entered into the field: `secureTextEntry` compiles to `type="password"` on web, and the HTML value sanitization algorithm strips CR and LF, so a pasted PEM arrives as one line. The plugin stores exactly what it receives: no reformatting, re-wrapping, key detection or base64 conversion. Interior spaces are kept and produce a non-blocking hint. A stripped key shows the `expectedLength` warning, which is the intended signal. The agent can ask for base64 in `hint`; the card does not encode. Prefix patterns are a non-blocking warning only.
9. **Daemon unreachable.** Offline banner. Send and Cancel are disabled. The field stays editable and keeps the typed value in memory, so a brief drop does not lose it. On reconnect the card reads `secrets.status`: `delivered` shows the delivered state with the countdown from the returned `handoffExpiresAt` and clears the buffer; `canceled` or `gone` shows that terminal state and clears the buffer; `pending` keeps the buffer. If the connection dropped during a send, the card reads status before any further send. Per the server rule (step 3), a repeat submit of a delivered request returns the same `handoffExpiresAt` and writes no second file, so a lost response recovers without a second delivery.
10. **RPC error.** Failed send: value kept, Try again button, danger notice with the server `message` (fallback copy). For `request-canceled` or `request-gone` there is no retry. The card clears the buffer and invalidates the status query, which moves it to `canceled` or `gone`.
11. **Unavailable.** `secrets.submit` returns `{status:"unavailable", message}` when the handoff root is unusable. The buffer is cleared, the input is removed, and the card becomes a read-only danger notice with no retry. The plugin normally refuses such requests before rendering any card, so this covers a condition that appears after the card is on screen.
12. **Idle.** Pending with no input for 5 minutes: buffer cleared, idle hint shown. The field accepts typing again.
13. **Unmount and remount.** Unmount drops the buffer. A remount (for example, a virtualized list scrolling the card out and back) starts with an empty field. Nothing is persisted. The request remains pending on the server.
14. **No replace, no re-entry.** The card has no replace action and never prefills an earlier value. If the agent needs a value again, it calls `request_secret` again and gets a new card with an empty field.
15. **Handoff file lifetime.** The file at `/dev/shm/paseo-<uid>-secret-request/<requestId>` is deleted 15 minutes after delivery, on `secret_release`, on cancel, on plugin reload and on daemon restart. `data` carries no deadline. The card learns `handoffExpiresAt` only from the submit result or `secrets.status`, and shows the countdown only while it is in the future.

## 2. Every state

Columns: **Card** = rendered content. **Input** = field. **Send** / **Cancel** = buttons. Only one lifecycle state is shown at a time; `offline` and `rpcError` overlay `pending-*`. Terminal states (`delivered`, `canceled`, `gone`, `unavailable`) remove the `TextInput` from the tree, so no text can be read from a hidden field.

| State                           | Trigger                                                                                                        | Card shows                                                                                                                                                                                                                                             | Input                                  | Send                               | Cancel   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------- | -------- |
| `pending-empty`                 | Request received, no text                                                                                      | Headline, label, description, hint, request id, wait line, policy line, placeholder                                                                                                                                                                    | editable, masked, auto-focus if newest | disabled                           | enabled  |
| `pending-focused`               | Field focused, no text                                                                                         | Same; accent border on field                                                                                                                                                                                                                           | editable, masked                       | disabled                           | enabled  |
| `pending-filled`                | Text present, no blocking condition                                                                            | Same, plus "Ready to send"                                                                                                                                                                                                                             | editable, masked                       | enabled                            | enabled  |
| `pending-empty-submit-rejected` | Return key with empty or whitespace-only text                                                                  | "Enter the value to send." (alert role); focus stays in field                                                                                                                                                                                          | editable, focused                      | disabled                           | enabled  |
| `pending-hint-whitespace`       | Interior spaces after trim (a pasted PEM or SSH key can contain them if the header line is pasted as one line) | "Contains spaces. Keep them if the value needs them." Non-blocking, muted tone                                                                                                                                                                         | editable                               | enabled                            | enabled  |
| `pending-hint-short`            | Trimmed length < `expectedLength`                                                                              | "Shorter than expected. You can still send." Warning tone                                                                                                                                                                                              | editable                               | enabled                            | enabled  |
| `pending-hint-long`             | Trimmed length > `expectedLength`                                                                              | "Longer than expected. You can still send." Warning tone                                                                                                                                                                                               | editable                               | enabled                            | enabled  |
| `pending-hint-prefix`           | Starts with `export `, `Bearer `, or `Authorization:`                                                          | "This looks like part of a config line. It will be sent as typed." Warning tone                                                                                                                                                                        | editable                               | enabled                            | enabled  |
| `sending`                       | `secrets.submit` in flight                                                                                     | Spinner beside Send; "Sending…"                                                                                                                                                                                                                        | non-editable                           | busy, disabled                     | disabled |
| `delivered`                     | Submit returned `status: "delivered"`                                                                          | Success tone bar; "Passed to your agent; held in memory only and deleted automatically in {countdown}"; "The agent receives a file path it can read, not the value."; countdown updates each second; at zero, line becomes "Auto-delete time reached." | removed                                | removed                            | removed  |
| `canceled`                      | Cancel succeeded, or `status: "canceled"`                                                                      | Muted tone bar; "Canceled. The agent was told you declined."                                                                                                                                                                                           | removed                                | removed                            | removed  |
| `gone`                          | Status read or submit fails with `request-gone`                                                                | Muted tone bar; "Request interrupted. Ask the agent to request it again."; no countdown                                                                                                                                                                | removed; buffer cleared                | removed                            | removed  |
| `unavailable`                   | `secrets.submit` returns `status: "unavailable"` (handoff root unusable)                                       | Read-only danger tone bar; server message (fallback copy); no retry; no countdown                                                                                                                                                                      | removed; buffer cleared                | removed                            | removed  |
| `rpcError`                      | Submit or cancel failed while still pending                                                                    | Danger notice with server message (fallback copy); "Try again" when retryable                                                                                                                                                                          | editable, value kept                   | enabled if non-empty and retryable | enabled  |
| `offline`                       | Host connection lost                                                                                           | Warning banner "Paseo is offline. Reconnect to send."                                                                                                                                                                                                  | editable, value kept in memory         | disabled                           | disabled |
| `idle-cleared`                  | 5 minutes without input while pending                                                                          | "Cleared after inactivity. Type it again."                                                                                                                                                                                                             | editable, empty                        | disabled                           | enabled  |

Rules:

- `sending` disables every control, so a double tap cannot send twice.
- An `rpcError` with `request-canceled` or `request-gone` offers no retry. The card clears the buffer and invalidates the status query, which moves it to `canceled` or `gone`.
- On reconnect, the status read decides the state: `delivered` shows the countdown from `handoffExpiresAt` and clears the buffer; `canceled` or `gone` shows that terminal state and clears the buffer; `pending` keeps the buffer.
- `pending-hint-*` states can overlap. Display the first in this order: prefix, short or long, whitespace. Hints never block Send. Short and long rank above whitespace so a stripped key whose header has spaces still shows the length warning.
- Hints never show the value, its characters, its prefix or its length as a number. The only length information is the boolean comparison with `expectedLength`.
- `delivered` does not show the file path. The path is not secret, but the card has no use for it, and it stays out of the rendered tree.

## 3. Component tree

Props that matter are listed after the component name. `theme` and `layout` come from the host; `host.id` scopes RPC and query keys.

```
SecretRequestCard                         props: agentId, item, timestamp, theme, layout, host, isNewest
└─ View (testID="secret-request-card")    card surface, tone bar, gap 12
   ├─ View (row)                          flexDirection row, gap 10
   │  ├─ View (tone bar, decorative)      accessibilityElementsHidden; color from status tone
   │  └─ View (column, flex 1, minWidth 0)
   │     ├─ Text (headline)               testID="secret-request-headline", 16/22 600, live region polite
   │     ├─ Text (label)                  testID="secret-request-label", accessibilityRole="header", data.label (free text)
   │     ├─ Text (description)            testID="secret-request-description", optional
   │     ├─ Text (hint)                   testID="secret-request-hint", optional, data.hint
   │     └─ View (meta row)
   │        ├─ Mono (request id)          testID="secret-request-id", selectable, data.requestId
   │        ├─ Text (wait line)           testID="secret-request-wait", "Waiting {elapsed} min", pending and sending only
   │        └─ Text (expiry)              testID="secret-request-expiry", "No time limit"
   ├─ [status === "pending" && phase !== "unavailable"] View (form)
   │  ├─ Text (field label)               "Value", nativeID for label association
   │  ├─ View (input row)
   │  │  └─ TextInput                     testID="secret-request-input"
   │  │                                   secureTextEntry (always), autoCapitalize="none",
   │  │                                   autoCorrect={false}, autoComplete="off", spellCheck={false},
   │  │                                   textContentType="none", importantForAutofill="no",
   │  │                                   autoFocus={isNewest}, editable={!sending} (offline keeps it editable),
   │  │                                   returnKeyType="done", onChangeText, onSubmitEditing,
   │  │                                   accessibilityLabel from copy field.a11yLabel
   │  ├─ Text (problem / hint)            testID="secret-request-problem", tone by hint; role "alert" only for empty submit
   │  ├─ Text (ready)                     testID="secret-request-ready", when text is present and there is no problem
   │  ├─ Text (idle)                      testID="secret-request-idle", only after 5 minutes idle
   │  ├─ Text (field note)                testID="secret-request-field-note", pending only
   │  └─ View (actions row)
   │     ├─ Pressable (Cancel)            testID="secret-request-cancel", variant secondary, accessibilityRole="button"
   │     └─ Pressable (Send)              testID="secret-request-send", variant primary, accessibilityState {disabled, busy}
   ├─ [status === "delivered"] View (result)
   │  ├─ Text (note)                      testID="secret-request-delivered", success color, live region polite; delivered.note with the countdown nested
   │  │  └─ Text (countdown)              testID="secret-request-countdown", nested, tabular digits, bare clock; removed at zero, when the note switches to "Auto-delete time reached."
   │  └─ Text (path note)                 testID="secret-request-delivered-note", "The agent receives a file path it can read, not the value."
   ├─ [status === "canceled" | "gone"] View (result)
   │  └─ Text (terminal line)             testID="secret-request-result", canceled.line or gone copy
   ├─ [phase === "unavailable"] Notice (danger, role alert)
   │  ├─ Text (title)                     testID="secret-request-unavailable", fixed copy
   │  └─ Text (server message)            testID="secret-request-unavailable-message", fallback copy
   ├─ [offline] Notice (warning)          testID="secret-request-offline"
   ├─ [phase === "rpcError"] Notice (danger, role alert)
   │  ├─ Text (server message)            testID="secret-request-error"
   │  └─ Pressable (Try again)            testID="secret-request-retry", pending only
   └─ Text (timestamp)                    testID="secret-request-timestamp", muted, requested time
```

Notes:

- `data.label` is free text. It is rendered as plain text and never used as an identifier, a URL, a path, or a shell argument.
- The monospace element shows only `requestId`. No variable name appears anywhere on the card.
- The card does not render a reveal control, a copy button, or a character counter.
- `Notice` and the button and banner styles are copied locally from the devenv pattern. Each plugin stays independently installable.
- `data.status` has three values: `pending`, `delivered`, `canceled`. `gone` is client-derived from a status read that fails with `request-gone`. `sending`, `rpcError` and `unavailable` are card-local `phase` values; `offline` is derived from a failing status query.
- `secret-request-spinner` is the ActivityIndicator inside Send while sending.

### Copy: English and Simplified Chinese

Strings use `{label}`, `{time}`, `{elapsed}`, `{countdown}`, `{id}`, and `{message}` placeholders. Chinese copy calls the agent "Bot", following the delivered-note wording. Locale comes from the device (`Intl`), with English as fallback; any `zh*` locale uses Simplified Chinese.

| Key                    | English                                                                            | 简体中文                                                 |
| ---------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `headline.pending`     | Secret requested                                                                   | 需要提供密钥                                             |
| `headline.sending`     | Sending secret…                                                                    | 正在发送密钥…                                            |
| `headline.delivered`   | Secret delivered                                                                   | 密钥已交付                                               |
| `headline.canceled`    | Request canceled                                                                   | 请求已取消                                               |
| `headline.gone`        | Request interrupted                                                                | 请求已中断                                               |
| `headline.unavailable` | Cannot hand over the value                                                         | 无法交接密钥                                             |
| `field.label`          | Value                                                                              | 值                                                       |
| `field.note`           | Typed text is hidden and never added to the chat.                                  | 输入内容已隐藏，不会加入聊天记录。                       |
| `field.a11yLabel`      | Secret value for {label}                                                           | {label} 的密钥值                                         |
| `field.placeholder`    | Paste or type the value                                                            | 粘贴或输入该值                                           |
| `meta.requestId`       | Request {id}                                                                       | 请求 {id}                                                |
| `meta.wait`            | Waiting {elapsed} min                                                              | 已等待 {elapsed} 分钟                                    |
| `meta.noExpiry`        | No time limit                                                                      | 无时间限制                                               |
| `meta.requestedAt`     | Requested {time}                                                                   | 请求于 {time}                                            |
| `action.send`          | Send to agent                                                                      | 发送给 Bot                                               |
| `action.sending`       | Sending…                                                                           | 发送中…                                                  |
| `action.cancel`        | Cancel                                                                             | 取消                                                     |
| `action.retry`         | Try again                                                                          | 重试                                                     |
| `problem.empty`        | Enter the value to send.                                                           | 请输入要发送的值。                                       |
| `hint.whitespace`      | Contains spaces. Keep them if the value needs them.                                | 包含空格。如果该值需要，请保留它们。                     |
| `hint.short`           | Shorter than expected. You can still send.                                         | 比预期短。仍可发送。                                     |
| `hint.long`            | Longer than expected. You can still send.                                          | 比预期长。仍可发送。                                     |
| `hint.prefix`          | This looks like part of a config line. It will be sent as typed.                   | 这看起来像配置行的一部分。将按输入原样发送。             |
| `ready`                | Ready to send                                                                      | 可以发送                                                 |
| `idle`                 | Cleared after inactivity. Type it again.                                           | 因长时间未操作已清空。请重新输入。                       |
| `delivered.note`       | Passed to your agent; held in memory only and deleted automatically in {countdown} | 已安全传递给你的 Bot，仅存于内存，{countdown} 后自动清除 |
| `delivered.path`       | The agent receives a file path it can read, not the value.                         | Bot 收到的是可读取的文件路径，而不是值本身。             |
| `delivered.expired`    | Auto-delete time reached.                                                          | 已到自动清除时间。                                       |
| `canceled.line`        | Canceled. The agent was told you declined.                                         | 已取消。已告知 Bot 你未提供密钥。                        |
| `gone.line`            | Request interrupted. Ask the agent to request it again.                            | 请求已中断，请让 agent 重新请求。                        |
| `unavailable.title`    | Cannot hand over the value safely: no memory-backed mount on this host             | 无法安全交接密钥：本机没有可用的内存盘                   |
| `unavailable.fallback` | The value was not sent and was not stored.                                         | 未发送，也未保存该值。                                   |
| `offline`              | Paseo is offline. Reconnect to send.                                               | Paseo 已离线。重新连接后即可发送。                       |
| `error.generic`        | The value could not be sent. Your input is kept.                                   | 无法发送，输入内容已保留。                               |
| `a11y.card`            | Secret request: {label}                                                            | 密钥请求：{label}                                        |

Copy rules:

- No copy repeats or hints at the value's characters, prefix, or length beyond the `expectedLength` comparison.
- Error copy uses the server `message` when present, otherwise `error.generic` or `unavailable.fallback`. Raw payloads are never rendered.
- The `{label}` placeholder is user-supplied text. It is inserted as a plain string, never as markup.

## 4. Visual spec

### Tokens

- Card: `surface1` background, 1px `border`, 12px radius, 3px left rule in the status tone (same pattern as devenv `Notice`). Padding 16 desktop, 12 compact. Gap 12.
- Field: `surface2` background, 1px `border`, 6px radius, 48px minimum height on compact and native, 44px on desktop web. Horizontal padding 12. Font 16 on native so iOS does not zoom.
- Send: `accent` background, `accentForeground` text, 600 weight, 44px minimum height. Cancel: `surface1` background, 1px `border`, `foreground` text, 44px minimum height. Disabled controls use opacity 0.5.
- Headline: 16/22, 600, `foreground`. Label: 14/20, 600, `foreground`. Description and hint: 13/19, `foregroundMuted`. Meta and timestamp: 12/17, `foregroundMuted`.
- Countdown: 14/20, 600, `statusSuccess`, `fontVariant: ["tabular-nums"]` so digits do not jump each second.
- Tone by state: `pending`, `sending`: `accent`. `delivered`: `statusSuccess`. `canceled`, `gone`: `foregroundMuted`. `unavailable`, `rpcError`: `statusDanger`. `hint.short`, `hint.long`, `hint.prefix`, `offline`: `statusWarning`. `hint.whitespace`: `foregroundMuted`.
- Compact (`layout.compact` true): card padding 12, buttons full width stacked, Send above Cancel. Desktop: buttons in a row, Cancel left of Send, `maxWidth` 560.

### Hierarchy

Headline first (state), then label (what is being asked for), then description (why), then hint (where to find it), then meta (request id, wait or expiry), then the field and actions. The label is the only thing the user needs to recognise the request; the request id is for support and log correlation only.

### Distinct from a chat message

The card is a bordered surface with a tone rule, a state headline and interactive controls. Chat messages are unbordered text without fields or buttons. The card does not use a speech bubble or an author avatar, so it does not look like the agent said it.

### Indicating a secret field

- Field label "Value" sits above the field.
- The field shows masked dots (`secureTextEntry`) and nothing else.
- A helper line under the field reads "Typed text is hidden and never added to the chat." It is shown in `pending-*` states only.
- No lock glyph or colour-only signal. The text carries the meaning.

### Masked vs revealed

The field is always masked. There is no show/hide control, no reveal long-press, and no copy-to-clipboard control. The only visible trace of typing is the dot count, which reflects the typed length; this is accepted because the card has no length counter and the dots disappear on send.

### After successful send

The field and both buttons are removed. The card shows:

1. Headline "Secret delivered".
2. Label (for example "测试密码"), so the user sees which request was answered.
3. The delivered note: "Passed to your agent; held in memory only and deleted automatically in 14:52".
4. "The agent receives a file path it can read, not the value."
5. The countdown, updating each second. When it reaches zero the line reads "Auto-delete time reached." The card cannot verify deletion, so it does not claim it.

The value does not appear anywhere on the card, and neither does the file path.

### Wireframes

Desktop, pending:

```text
┌────────────────────────────────────────────────────────────┐
│▌ Secret requested                                          │
│▌ Test password                                             │
│▌ Used for the staging login test.                          │
│▌ Hint: check the staging entry in your password manager.   │
│▌ req_7f3a   Waiting 2 min   No time limit                  │
│▌                                                           │
│▌ Value                                                     │
│▌ ┌──────────────────────────────────────────────────────┐   │
│▌ │ ••••••••••••                                         │   │
│▌ └──────────────────────────────────────────────────────┘   │
│▌ Typed text is hidden and never added to the chat.         │
│▌                                    [ Cancel ] [ Send ]    │
└────────────────────────────────────────────────────────────┘
```

Desktop, delivered:

```text
┌────────────────────────────────────────────────────────────┐
│▌ Secret delivered                                          │
│▌ Test password                                             │
│▌ Passed to your agent; held in memory only and deleted     │
│▌ automatically in 14:52                                    │
│▌ The agent receives a file path it can read, not the value.│
│▌ req_7f3a   Requested 10:02                                │
└────────────────────────────────────────────────────────────┘
```

Compact (phone), pending:

```text
┌──────────────────────────────┐
│▌ Secret requested            │
│▌ Test password               │
│▌ Used for the staging login. │
│▌ req_7f3a · waiting 2 min    │
│▌ Value                       │
│▌ ┌──────────────────────────┐ │
│▌ │ ••••••••••••             │ │
│▌ └──────────────────────────┘ │
│▌ ┌──────────────────────────┐ │
│▌ │       Send to agent      │ │
│▌ └──────────────────────────┘ │
│▌ ┌──────────────────────────┐ │
│▌ │          Cancel          │ │
│▌ └──────────────────────────┘ │
└──────────────────────────────┘
```

## 5. Security-relevant UI decisions

- **Keyboard and autofill.** `secureTextEntry`, `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="off"`, `spellCheck={false}`, `textContentType="none"`, `importantForAutofill="no"`. Suggestions and autofill are suppressed where the platform honours them; third-party keyboards may still learn from input, which the card cannot control. This is stated in the user-facing helper line only as "hidden", not as "never stored by your keyboard".
- **Paste.** Allowed. The card never reads the clipboard itself, so no clipboard permission is needed and no paste button exists.
- **Newline handling (decided).** Newlines cannot be entered into the masked field, and the card does not try to preserve them. The plugin stores the trimmed value exactly as received. A PEM key pasted into the field arrives without line breaks; the agent or server is responsible for detecting that and asking for a corrected value (the `expectedLength` warning is the signal for a stripped key). The card does not reformat, re-wrap, detect key types, or base64-encode. The agent can request a base64 encoding in `hint`.
- **Trim consequences.** Trimming removes spaces at the ends of the value only. A pasted key therefore reaches the plugin without a trailing newline, and the plugin does not add one. The agent decides how to handle a key that arrives without line breaks.
- **No show/hide.** Removed. Reveal would put cleartext on screen, where screenshots, screen sharing, shoulder-surfing and screen recorders can capture it. It would also add a second state to test.
- **Read-back after send.** Never. The card does not read the `TextInput` after send, and does not read it back into state. The value is passed once to `secrets.submit`.
- **Buffer clearing.** The buffer is a ref, not rendered state. On success, the ref is set to `""` and `TextInput.clear()` is called. The buffer is also cleared on `canceled`, `gone`, `unavailable`, idle clearing, unmount, and any terminal status read. On `rpcError` with a retryable error, the buffer is kept so the user can retry. JavaScript strings cannot be zeroed; the spec's guarantee is that the card drops its references and renders nothing from them.
- **Unmount.** Clears the buffer ref and does not call any RPC. A send in flight at unmount completes on the server; the component ignores its result and sets no state. The value is not persisted to storage, route params, or any cache.
- **Logging and telemetry.** The value never goes into props, timeline `data`, query keys, analytics, error reporters, or `console`. RPC payloads are not logged by the card. Errors are rendered from `message` only.
- **Permanent transcript form.** The transcript keeps the request label, request id, and the delivered note. It never keeps the value, the handoff file path, or any prefix or length. A screenshot of a delivered card contains no secret material. A screenshot of a pending card contains the masked dots, which show a count and nothing else.
- **Handoff lifetime.** The file is `/dev/shm/paseo-<uid>-secret-request/<requestId>`, RAM-backed, `0600`. The card only displays the countdown. Deletion happens 15 minutes after delivery, on `secret_release`, on cancel, on plugin reload and on daemon restart.
- **Daemon restart while waiting.** The blocked call cannot survive a restart. A status read after restart fails with `request-gone`, and the card shows the `gone` state. The card does not infer a canceled outcome.
- **Non-secret identifiers.** Only `requestId` is shown as an identifier. `label` is free text, rendered as plain text, never used as a key, path or URL.

## 6. Component sketch

File: `plugins/secret-request/client/card.tsx`. Sketch only; not added to the repo. Contract names are assumed: `statusRpc`, `submitRpc`, `cancelRpc` from `shared/contracts`; `SecretRequestData`, `SecretStatus` from `shared/protocol`. `SecretStatus` is `{status: "pending" | "delivered" | "canceled", handoffExpiresAt: string | null}`. `submitRpc` returns `delivered {handoffExpiresAt} | unavailable {message}` and fails with `request-canceled` or `request-gone`. `statusRpc` fails with `request-gone` when the server no longer knows the request.

The field is uncontrolled: the typed text lives only in `buffer`, a ref, and is never in React state, props, or query data. `buffer` is read by `mutationFn`, so the value is not in mutation variables or the react-query cache.

```tsx
import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { cancelRpc, statusRpc, submitRpc } from "../shared/contracts";
import type { SecretRequestData, SecretStatus } from "../shared/protocol";

type Props = PluginHostProps & {
  agentId: string;
  item: { data: SecretRequestData };
  timestamp: Date;
  isNewest: boolean;
};

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

type HintKey = "none" | "whitespace" | "prefix" | "short" | "long";

type Phase =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "rpcError"; message: string; retry: "send" | "cancel" | null }
  | { kind: "unavailable"; message: string };

type ViewStatus = SecretStatus["status"] | "gone";
type CardView = "form" | "delivered" | "canceled" | "gone" | "unavailable";

const IDLE_MS = 5 * 60_000;

const toneColors = {
  neutral: "foregroundMuted",
  accent: "accent",
  success: "statusSuccess",
  warning: "statusWarning",
  danger: "statusDanger",
} satisfies Record<Tone, keyof PluginTheme["colors"]>;

const en = {
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
    a11yLabel: (label: string) => `Secret value for ${label}`,
    placeholder: "Paste or type the value",
    note: "Typed text is hidden and never added to the chat.",
  },
  wait: (minutes: number) => `Waiting ${minutes} min`,
  noExpiry: "No time limit",
  requestedAt: (time: string) => `Requested ${time}`,
  action: {
    send: "Send to agent",
    sending: "Sending…",
    cancel: "Cancel",
    retry: "Try again",
  },
  emptyRejected: "Enter the value to send.",
  hint: {
    whitespace: "Contains spaces. Keep them if the value needs them.",
    prefix: "This looks like part of a config line. It will be sent as typed.",
    short: "Shorter than expected. You can still send.",
    long: "Longer than expected. You can still send.",
  },
  ready: "Ready to send",
  idle: "Cleared after inactivity. Type it again.",
  deliveredNote: {
    before:
      "Passed to your agent; held in memory only and deleted automatically in ",
    after: "",
  },
  deliveredExpired: "Auto-delete time reached.",
  deliveredPath: "The agent receives a file path it can read, not the value.",
  canceled: "Canceled. The agent was told you declined.",
  gone: "Request interrupted. Ask the agent to request it again.",
  unavailable: {
    title:
      "Cannot hand over the value safely: no memory-backed mount on this host",
    fallback: "The value was not sent and was not stored.",
  },
  offline: "Paseo is offline. Reconnect to send.",
  errorGeneric: "The value could not be sent. Your input is kept.",
  a11yCard: (label: string) => `Secret request: ${label}`,
};

type Copy = typeof en;

const zh = {
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
    a11yLabel: (label: string) => `${label} 的密钥值`,
    placeholder: "粘贴或输入该值",
    note: "输入内容已隐藏，不会加入聊天记录。",
  },
  wait: (minutes: number) => `已等待 ${minutes} 分钟`,
  noExpiry: "无时间限制",
  requestedAt: (time: string) => `请求于 ${time}`,
  action: {
    send: "发送给 Bot",
    sending: "发送中…",
    cancel: "取消",
    retry: "重试",
  },
  emptyRejected: "请输入要发送的值。",
  hint: {
    whitespace: "包含空格。如果该值需要，请保留它们。",
    prefix: "这看起来像配置行的一部分。将按输入原样发送。",
    short: "比预期短。仍可发送。",
    long: "比预期长。仍可发送。",
  },
  ready: "可以发送",
  idle: "因长时间未操作已清空。请重新输入。",
  deliveredNote: {
    before: "已安全传递给你的 Bot，仅存于内存，",
    after: " 后自动清除",
  },
  deliveredExpired: "已到自动清除时间。",
  deliveredPath: "Bot 收到的是可读取的文件路径，而不是值本身。",
  canceled: "已取消。已告知 Bot 你未提供密钥。",
  gone: "请求已中断，请让 agent 重新请求。",
  unavailable: {
    title: "无法安全交接密钥：本机没有可用的内存盘",
    fallback: "未发送，也未保存该值。",
  },
  offline: "Paseo 已离线。重新连接后即可发送。",
  errorGeneric: "无法发送，输入内容已保留。",
  a11yCard: (label: string) => `密钥请求：${label}`,
} satisfies Copy;

const LOCALE = Intl.DateTimeFormat().resolvedOptions().locale;
const copy: Copy = LOCALE.startsWith("zh") ? zh : en;

function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function classifyHint(
  trimmed: string,
  expectedLength: number | undefined,
): HintKey {
  if (trimmed.length === 0) return "none";
  if (/^(export\s|Bearer\s|Authorization:)/i.test(trimmed)) return "prefix";
  if (expectedLength !== undefined && trimmed.length < expectedLength)
    return "short";
  if (expectedLength !== undefined && trimmed.length > expectedLength)
    return "long";
  if (trimmed.includes(" ")) return "whitespace";
  return "none";
}

function hintMessage(key: HintKey): string | null {
  switch (key) {
    case "none":
      return null;
    case "whitespace":
      return copy.hint.whitespace;
    case "prefix":
      return copy.hint.prefix;
    case "short":
      return copy.hint.short;
    case "long":
      return copy.hint.long;
  }
}

function resolveView(status: ViewStatus, phase: Phase): CardView {
  switch (status) {
    case "pending":
      return phase.kind === "unavailable" ? "unavailable" : "form";
    case "delivered":
      return "delivered";
    case "canceled":
      return "canceled";
    case "gone":
      return "gone";
  }
}

function headline(view: CardView, sending: boolean): string {
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

function viewTone(view: CardView): Tone {
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
      gap: 10,
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
    },
    countdown: { fontWeight: "600", fontVariant: ["tabular-nums"] },
    field: { gap: 6 },
    input: {
      color: colors.foreground,
      fontSize: 16,
      minHeight: compact ? 48 : 44,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      borderRadius: 6,
    },
    actions: {
      flexDirection: compact ? "column-reverse" : "row",
      justifyContent: "flex-end",
      gap: 8,
    },
    button: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
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
      backgroundColor: colors.surface2,
      borderLeftWidth: 3,
      borderRadius: 8,
      padding: 12,
      gap: 6,
    },
  });
}

type Styles = ReturnType<typeof makeStyles>;

function Banner({
  s,
  borderColor,
  role,
  children,
}: {
  s: Styles;
  borderColor: string;
  role?: "alert";
  children: ReactNode;
}) {
  return (
    <View
      accessibilityRole={role}
      style={[s.banner, { borderLeftColor: borderColor }]}
    >
      {children}
    </View>
  );
}

function requestCode(error: unknown): string | null {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function isTerminalRequest(error: unknown): boolean {
  const code = requestCode(error);
  return code === "request-canceled" || code === "request-gone";
}

function rpcFailure(error: unknown, retry: "send" | "cancel"): Phase {
  return {
    kind: "rpcError",
    message: error instanceof Error ? error.message : copy.errorGeneric,
    retry: isTerminalRequest(error) ? null : retry,
  };
}

export function SecretRequestCard({
  agentId,
  item,
  timestamp,
  theme,
  layout,
  host,
  isNewest,
}: Props) {
  const { requestId, label, description, hint, expectedLength, createdAt } =
    item.data;
  const statusKey = useMemo(
    () => ["secret-request", host.id, agentId, requestId],
    [host.id, agentId, requestId],
  );
  const queries = useQueryClient();
  const readStatus = useRpc(statusRpc);
  const submit = useRpc(submitRpc);
  const cancel = useRpc(cancelRpc);
  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: () => readStatus({ agentId, requestId }),
    refetchInterval: (query) => {
      const current = query.state.data?.status;
      return current === "delivered" ||
        current === "canceled" ||
        requestCode(query.state.error) === "request-gone"
        ? false
        : 5000;
    },
  });
  const gone = requestCode(statusQuery.error) === "request-gone";
  const serverStatus: ViewStatus = gone
    ? "gone"
    : (statusQuery.data?.status ?? item.data.status);
  const handoffExpiresAt = statusQuery.data?.handoffExpiresAt ?? null;
  const offline = statusQuery.isError && !gone;
  const s = useMemo(
    () => makeStyles(theme, layout.compact, layout.platform),
    [theme, layout.compact, layout.platform],
  );
  const buffer = useRef("");
  const lastInput = useRef(Date.now());
  const inputRef = useRef<TextInput>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [hasText, setHasText] = useState(false);
  const [hintKey, setHintKey] = useState<HintKey>("none");
  const [emptyRejected, setEmptyRejected] = useState(false);
  const [idleCleared, setIdleCleared] = useState(false);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sending = phase.kind === "sending";
  const view = resolveView(serverStatus, phase);
  const clearBuffer = useCallback(() => {
    buffer.current = "";
    inputRef.current?.clear();
    setHasText(false);
    setHintKey("none");
    setEmptyRejected(false);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (view !== "form" || sending) return;
    const id = setInterval(() => {
      if (Date.now() - lastInput.current >= IDLE_MS) {
        clearBuffer();
        setIdleCleared(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [view, sending, clearBuffer]);
  useEffect(() => {
    if (serverStatus !== "pending") clearBuffer();
  }, [serverStatus, clearBuffer]);
  useEffect(
    () => () => {
      buffer.current = "";
    },
    [],
  );
  const deliver = useMutation({
    mutationFn: () =>
      submit({ agentId, requestId, value: buffer.current.trim() }),
    onMutate: () => setPhase({ kind: "sending" }),
    onSuccess: (result) => {
      switch (result.status) {
        case "delivered":
          clearBuffer();
          setPhase({ kind: "editing" });
          queries.setQueryData<SecretStatus>(statusKey, {
            status: "delivered",
            handoffExpiresAt: result.handoffExpiresAt,
          });
          return;
        case "unavailable":
          clearBuffer();
          setPhase({ kind: "unavailable", message: result.message });
          return;
      }
    },
    onError: async (error) => {
      if (isTerminalRequest(error)) {
        clearBuffer();
        await queries.invalidateQueries({ queryKey: statusKey });
        return;
      }
      setPhase(rpcFailure(error, "send"));
    },
  });
  const decline = useMutation({
    mutationFn: () => cancel({ agentId, requestId }),
    onSuccess: () => {
      clearBuffer();
      queries.setQueryData<SecretStatus>(statusKey, {
        status: "canceled",
        handoffExpiresAt: null,
      });
    },
    onError: async (error) => {
      if (isTerminalRequest(error)) {
        clearBuffer();
        await queries.invalidateQueries({ queryKey: statusKey });
        return;
      }
      setPhase(rpcFailure(error, "cancel"));
    },
  });
  const onChangeText = (text: string) => {
    buffer.current = text;
    lastInput.current = Date.now();
    const trimmed = text.trim();
    setIdleCleared(false);
    setEmptyRejected(false);
    setHasText(trimmed.length > 0);
    setHintKey(classifyHint(trimmed, expectedLength));
  };
  const onSend = () => {
    if (buffer.current.trim().length === 0) {
      setEmptyRejected(true);
      inputRef.current?.focus();
      return;
    }
    deliver.mutate();
  };
  const onCancel = () => decline.mutate();
  const toneColor = (tone: Tone) => theme.colors[toneColors[tone]];
  const hintText = hintMessage(hintKey);
  const warningHint =
    hintKey === "prefix" || hintKey === "short" || hintKey === "long";
  const tone: Tone =
    phase.kind === "unavailable" || phase.kind === "rpcError"
      ? "danger"
      : warningHint
        ? "warning"
        : viewTone(view);
  const minutesWaiting = Math.max(
    0,
    Math.floor((now - Date.parse(createdAt)) / 60_000),
  );
  const handoffRemaining =
    handoffExpiresAt === null ? 0 : Date.parse(handoffExpiresAt) - now;
  const sendDisabled =
    !hasText ||
    sending ||
    offline ||
    (phase.kind === "rpcError" && phase.retry === null);
  return (
    <View
      testID="secret-request-card"
      accessibilityLabel={copy.a11yCard(label)}
      style={s.card}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[s.rule, { backgroundColor: toneColor(tone) }]}
      />
      <View style={s.column}>
        <View style={s.stack}>
          <Text
            testID="secret-request-headline"
            accessibilityLiveRegion="polite"
            style={s.headline}
          >
            {headline(view, sending)}
          </Text>
          <Text
            testID="secret-request-label"
            accessibilityRole="header"
            style={s.label}
          >
            {label}
          </Text>
          {description ? (
            <Text testID="secret-request-description" style={s.body}>
              {description}
            </Text>
          ) : null}
          {hint ? (
            <Text testID="secret-request-hint" style={s.body}>
              {hint}
            </Text>
          ) : null}
        </View>
        <View style={s.meta}>
          <Text selectable testID="secret-request-id" style={s.mono}>
            {requestId}
          </Text>
          {view === "form" ? (
            <Text testID="secret-request-wait" style={s.muted}>
              {copy.wait(minutesWaiting)}
            </Text>
          ) : null}
          <Text testID="secret-request-expiry" style={s.muted}>
            {copy.noExpiry}
          </Text>
        </View>
        {view === "form" ? (
          <View style={s.field}>
            <Text style={s.body}>{copy.field.label}</Text>
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
              autoFocus={isNewest}
              editable={!sending}
              returnKeyType="done"
              onChangeText={onChangeText}
              onSubmitEditing={onSend}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={[
                s.input,
                focused ? { borderColor: theme.colors.accent } : null,
              ]}
            />
            <Text testID="secret-request-field-note" style={s.muted}>
              {copy.field.note}
            </Text>
            {emptyRejected ? (
              <Text
                accessibilityRole="alert"
                testID="secret-request-problem"
                style={{ color: toneColor("danger") }}
              >
                {copy.emptyRejected}
              </Text>
            ) : hintText ? (
              <Text
                testID="secret-request-problem"
                style={{
                  color: toneColor(warningHint ? "warning" : "neutral"),
                }}
              >
                {hintText}
              </Text>
            ) : hasText ? (
              <Text testID="secret-request-ready" style={s.muted}>
                {copy.ready}
              </Text>
            ) : null}
            {idleCleared ? (
              <Text testID="secret-request-idle" style={s.muted}>
                {copy.idle}
              </Text>
            ) : null}
            <View style={s.actions}>
              <Pressable
                testID="secret-request-cancel"
                accessibilityRole="button"
                accessibilityLabel={copy.action.cancel}
                accessibilityState={{ disabled: sending || offline }}
                disabled={sending || offline}
                onPress={onCancel}
                style={({ pressed }) => [
                  s.button,
                  s.secondary,
                  { opacity: sending || offline ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                <Text style={s.secondaryText}>{copy.action.cancel}</Text>
              </Pressable>
              <Pressable
                testID="secret-request-send"
                accessibilityRole="button"
                accessibilityLabel={
                  sending ? copy.action.sending : copy.action.send
                }
                accessibilityState={{ disabled: sendDisabled, busy: sending }}
                disabled={sendDisabled}
                onPress={onSend}
                style={({ pressed }) => [
                  s.button,
                  s.primary,
                  { opacity: sendDisabled ? 0.5 : pressed ? 0.85 : 1 },
                ]}
              >
                {sending ? (
                  <ActivityIndicator
                    testID="secret-request-spinner"
                    color={theme.colors.accentForeground}
                  />
                ) : null}
                <Text style={s.primaryText}>
                  {sending ? copy.action.sending : copy.action.send}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {view === "delivered" ? (
          <View style={s.stack}>
            <Text
              testID="secret-request-delivered"
              accessibilityLiveRegion="polite"
              style={[s.body, { color: toneColor("success") }]}
            >
              {handoffRemaining > 0 ? (
                <>
                  {copy.deliveredNote.before}
                  <Text testID="secret-request-countdown" style={s.countdown}>
                    {formatClock(handoffRemaining)}
                  </Text>
                  {copy.deliveredNote.after}
                </>
              ) : (
                copy.deliveredExpired
              )}
            </Text>
            <Text testID="secret-request-delivered-note" style={s.muted}>
              {copy.deliveredPath}
            </Text>
          </View>
        ) : null}
        {view === "canceled" || view === "gone" ? (
          <Text testID="secret-request-result" style={s.body}>
            {view === "canceled" ? copy.canceled : copy.gone}
          </Text>
        ) : null}
        {phase.kind === "unavailable" ? (
          <Banner s={s} borderColor={toneColor("danger")} role="alert">
            <Text testID="secret-request-unavailable" style={s.label}>
              {copy.unavailable.title}
            </Text>
            <Text testID="secret-request-unavailable-message" style={s.body}>
              {phase.message || copy.unavailable.fallback}
            </Text>
          </Banner>
        ) : null}
        {view === "form" && phase.kind === "rpcError" ? (
          <Banner s={s} borderColor={toneColor("danger")} role="alert">
            <Text testID="secret-request-error" style={s.body}>
              {phase.message}
            </Text>
            {phase.retry !== null ? (
              <Pressable
                testID="secret-request-retry"
                accessibilityRole="button"
                accessibilityLabel={copy.action.retry}
                disabled={offline}
                onPress={phase.retry === "cancel" ? onCancel : onSend}
                style={[s.button, s.secondary]}
              >
                <Text style={s.secondaryText}>{copy.action.retry}</Text>
              </Pressable>
            ) : null}
          </Banner>
        ) : null}
        {offline ? (
          <Banner s={s} borderColor={toneColor("warning")}>
            <Text testID="secret-request-offline" style={s.body}>
              {copy.offline}
            </Text>
          </Banner>
        ) : null}
        <Text testID="secret-request-timestamp" style={s.muted}>
          {copy.requestedAt(formatTime(timestamp))}
        </Text>
      </View>
    </View>
  );
}
```

Notes for the sketch:

- `copy` is chosen from the device locale. `zh` is `satisfies Copy`, so a missing key fails type-checking.
- The typed value lives only in `buffer` (a ref) and the uncontrolled `TextInput`. It is never in state, props, query data, or mutation variables; `deliver.mutationFn` reads `buffer.current` at call time. `buffer` is cleared on send, cancel, unmount, and on any terminal status read.
- Contract assumption: `delivered` always carries a non-null `handoffExpiresAt`. Requests never expire; the only deadline is the handoff file, 15 minutes after delivery.
- `classifyHint` receives the trimmed text and returns a `HintKey`. The text itself is not stored.
- `resolveView`, `headline`, `viewTone` and `hintMessage` switch exhaustively over their unions with no `default`. `ViewStatus` adds `gone` to the server status set, so a new server status breaks the build.
- `submitRpc` returns `delivered` for a request already delivered, with the same `handoffExpiresAt`, and writes no second file. For a canceled request, it fails with `request-canceled`; for an unknown request, it fails with `request-gone`.
- No `as` assertions, no non-null `!`, no `void`, no comments. `requestCode` narrows with `in` and `typeof` instead of asserting.

## 7. E2E-selectable surface

Playwright targets `testID`s through React Native Web, which renders `testID` as `data-testid`. Roles are asserted with `getByRole`, names with `getByRole(..., {name})`, and text with `toHaveText` on the `testID` element. Assertions check visible feedback only, never the typed value.

| testID                               | Role / name                                  | Present in states                            | Asserted feedback                                                                                                                                     |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret-request-card`                | region, name = `copy.a11yCard(label)`        | all                                          | visible; contains label text                                                                                                                          |
| `secret-request-headline`            | live polite                                  | all                                          | text equals headline for the state (see section 2)                                                                                                    |
| `secret-request-label`               | heading                                      | all                                          | text equals `data.label`                                                                                                                              |
| `secret-request-description`         | —                                            | when `description` set                       | text equals `data.description`                                                                                                                        |
| `secret-request-hint`                | —                                            | when `data.hint` set                         | text equals `data.hint`                                                                                                                               |
| `secret-request-id`                  | —                                            | all                                          | text equals `requestId`                                                                                                                               |
| `secret-request-wait`                | —                                            | `pending-*`, `sending`                       | text matches `/^Waiting \d+ min$/`; minutes do not decrease across clock advance                                                                      |
| `secret-request-expiry`              | —                                            | all                                          | "No time limit" (requests never expire)                                                                                                               |
| `secret-request-input`               | textbox, name = `Secret value for {label}`   | `pending-*`, `sending` (disabled)            | `secureTextEntry` on native; `type="password"` on web; `editable` false during `sending`; absent after `delivered`, `canceled`, `gone`, `unavailable` |
| `secret-request-field-note`          | —                                            | `pending-*`                                  | "Typed text is hidden and never added to the chat."                                                                                                   |
| `secret-request-problem`             | role alert only for empty submit             | `pending-empty-submit-rejected`, hint states | text equals the hint or `emptyRejected` copy                                                                                                          |
| `secret-request-ready`               | —                                            | `pending-filled`                             | text "Ready to send"                                                                                                                                  |
| `secret-request-idle`                | —                                            | `idle-cleared`                               | text "Cleared after inactivity. Type it again."                                                                                                       |
| `secret-request-send`                | button, name = "Send to agent" or "Sending…" | `pending-*`, `sending`                       | disabled and `aria-disabled="true"` when empty, `sending`, offline; `aria-busy="true"` while sending                                                  |
| `secret-request-spinner`             | —                                            | `sending`                                    | visible while sending; absent otherwise                                                                                                               |
| `secret-request-cancel`              | button, name = "Cancel"                      | `pending-*`, `sending` (disabled)            | enabled in `pending-*`; after click the card shows `secret-request-result` "Canceled. The agent was told you declined."                               |
| `secret-request-delivered`           | live polite                                  | `delivered`                                  | text contains "held in memory only and deleted automatically in"                                                                                      |
| `secret-request-countdown`           | —                                            | `delivered`, before deadline                 | matches `/^\d{2}:\d{2}$/`; decreases about 1 second per tick; absent once zero                                                                        |
| `secret-request-delivered-note`      | —                                            | `delivered`                                  | text equals "The agent receives a file path it can read, not the value."                                                                              |
| `secret-request-result`              | —                                            | `canceled`, `gone`                           | "Canceled. The agent was told you declined." or "Request interrupted. Ask the agent to request it again."                                             |
| `secret-request-unavailable`         | —                                            | `unavailable`                                | text equals `unavailable.title`                                                                                                                       |
| `secret-request-unavailable-message` | —                                            | `unavailable`                                | text equals server message, or fallback when empty                                                                                                    |
| `secret-request-error`               | role alert                                   | `rpcError`                                   | text equals server message or generic copy                                                                                                            |
| `secret-request-retry`               | button, name = "Try again"                   | `rpcError` with retry                        | visible only when retryable; clicking re-invokes the failed action                                                                                    |
| `secret-request-offline`             | —                                            | offline                                      | text "Paseo is offline. Reconnect to send."                                                                                                           |
| `secret-request-timestamp`           | —                                            | all                                          | text matches `/^Requested \d{1,2}:\d{2}/` (localised)                                                                                                 |

Tests to write as real E2E (no mocks of the plugin host, transport or RPC):

- Send with a valid value: field disappears, `secret-request-delivered` appears, countdown is present, `secret-request-input` is absent, and no element on the page contains the typed string.
- Send empty: `secret-request-problem` shows "Enter the value to send." with role alert; no RPC is issued.
- Paste with interior spaces (for example a pasted header line): `secret-request-problem` shows the whitespace hint; the value sent over RPC keeps its interior spaces and loses only its outer whitespace.
- Cancel: `secret-request-result` shows the canceled copy; the agent-side tool call returns `{status:"canceled"}`.
- Short paste against `expectedLength`: `secret-request-problem` shows the short hint and Send stays enabled.
- Unavailable: the danger alert with `secret-request-unavailable` appears; no retry control exists.
- RPC failure with retry: `secret-request-error` appears, the typed value is still in the field, and `secret-request-retry` resubmits it.
- Offline: `secret-request-offline` appears; send and cancel are disabled; reconnect restores the editable field.
- Compact viewport (390 px): Send sits above Cancel and both are at least 44 px tall.
- Light and dark themes: the tone rule colour matches the `theme.colors` mapping for the state.
- `gone`: `secret-request-result` shows "Request interrupted. Ask the agent to request it again."; the input is absent and Send and Cancel do not render.
- Second submit of a delivered request returns the same `handoffExpiresAt` without a second file; a submit of a canceled request fails with `request-canceled` and the card shows the `canceled` state after a status read.

Negative assertions for every state: no element with a `testID` in this list displays the typed value, the handoff file path, or `handoffExpiresAt` as a bare timestamp outside the countdown.
