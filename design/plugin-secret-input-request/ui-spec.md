# Secret request card: UI specification

Plugin: `secret-request` (`plugins/secret-request`). Component: `SecretRequestCard`, rendered by the host for `item.kind === "secret-request"`, `version: 1`.

Model: one request, one answer. The `request_secret` tool call blocks until the user sends the value or cancels. The plugin never expires a request; the provider or agent runtime may still time out or cancel the tool call. On send, the daemon writes the value once to a `0600` file at `/dev/shm/paseo-<uid>-secret-request/<handoffId>/<requestId>`, a RAM-backed tmpfs mount. The blocked call returns `{status:"delivered", path, handoffExpiresAt}`. The tool result carries the path, never the value. The agent receives a file path it can read; the file is removed by TTL expiry (15 minutes after delivery), agent archive, or plugin start. Only `state.json` (MCP port and per-agent bearer tokens; user secret values never go there) lives under `PASEO_HOME`. Nothing is stored, granted, replaced or reused. The only MCP tool is `request_secret`.

Visual language follows the devenv plugin: `Notice`-style tone bar, `surface1` card, `surface2` field, 44px touch targets on native.

## 1. Interaction model

Principles:

- One-shot. No state survives beyond `data` and the typed buffer. No vault, no reuse, no replace, no re-entry of an earlier value.
- Data shape: `data` is `{requestId, label, description?, hint?, status, createdAt}`, where `status` is `pending | delivered | canceled`. `gone` is never stored in `data`; the card derives it from a status read (see section 2).
- RPC shapes: `secrets.status` returns `{status, handoffExpiresAt}` with `handoffExpiresAt: string | null`, and fails with `request-gone` when the server no longer knows the request. `secrets.submit` returns `{status:"delivered", handoffExpiresAt}` or `{status:"unavailable", message}`, and fails with `request-canceled` or `request-gone`. `secrets.cancel` resolves the blocked call with `{status:"canceled"}`.
- A `delivered` result always carries a non-null `handoffExpiresAt`. The plugin never expires a request; the only deadline is the handoff file's TTL, 15 minutes after delivery.
- `data.status` is the source of truth. Local state holds only the typed buffer (in a ref, never in state), a card-local `phase` (`editing`, `sending`, `rpcError`, `unavailable`), `hasText` and `idleCleared`. `offline` and `gone` are derived from the status query.
- Terminal: `delivered`, `canceled`, `gone`, and the card-local `unavailable`. None returns to input.
- The tool call has no time limit inside the plugin; the provider or agent runtime may still time out or cancel it. The card shows elapsed wait in minutes and never says or implies the agent gave up.
- Value rules: trim leading and trailing spaces on send. Interior spaces are kept. Newlines cannot be entered (section 5). Send is disabled while the trimmed value is empty; nothing else about the value's shape is judged, shown or hinted.

Lifecycle:

1. **Request.** Agent calls `request_secret({label, description?, hint?})`. The daemon creates a pending request (`requestId`, `createdAt`) and the call blocks. The card shows label, description, hint, request id and elapsed wait. The input is not auto-focused: the host exposes no "newest item" signal to a timeline renderer, and stealing focus is worse than requiring a tap.
2. **Type or paste.** The field is masked. The card shows no value-dependent hints.
3. **Send.** Send calls `secrets.submit({agentId, requestId, value})` with `value = input.trim()`. Input and Send go busy while the call is in flight, so one tap sends one value. There is no automatic retry. The server decides by the request's state:
   - Pending: writes the file once and returns `{status:"delivered", handoffExpiresAt}`.
   - Already delivered: returns the same `{status:"delivered", handoffExpiresAt}` again and writes no second file. A lost response recovers this way.
   - Canceled: fails with error code `request-canceled`.
   - Unknown to the server (plugin reloaded or daemon restarted): fails with error code `request-gone`.
   - Handoff write failed: returns `{status:"unavailable", message}` (step 11).
     Terminal errors resolve the card through a status read (step 10).
4. **Delivered.** The blocked call returns `{status:"delivered", path, handoffExpiresAt}` to the agent. The card clears the buffer, removes the input, and shows the delivered note with one fixed local time derived from `handoffExpiresAt`, plus "the agent receives a file path it can read, not the value".
5. **Cancel.** Cancel calls `secrets.cancel`. The buffer is cleared only after the call succeeds, so a failed cancel keeps the text. The blocked call resolves with `{status:"canceled"}`, so the agent learns the user declined. No confirmation dialog: cancel is the decline path. A canceled request never had a handoff file, so cancel removes nothing.
6. **Ignore.** A pending card stays pending until the user answers. Nothing is auto-sent or auto-canceled, and the card sends no reminders. One 30-second interval drives the wait line and the idle check. The delivered card has no clock.
7. **Gone.** When a status read or submit fails with `request-gone` (the plugin reloaded or the daemon restarted), the card shows the `gone` state: a muted headline, no input, no retry. The card reports only what the server returned and does not claim the agent is still waiting.
8. **Paste.** Always allowed. Newlines cannot be entered into the field: `secureTextEntry` compiles to `type="password"` on web, and the HTML value sanitization algorithm strips CR and LF, so a pasted PEM arrives as one line. The plugin stores exactly what it receives: no reformatting, re-wrapping, key detection or base64 conversion. The card judges no part of the value's shape. The agent can ask for base64 in `hint`; the card does not encode.
9. **Daemon unreachable.** Offline banner. Send and Cancel are disabled. The field stays editable and keeps the typed value in the card's buffer, so a brief drop does not lose it. On reconnect the card reads `secrets.status`: `delivered` shows the delivered state with the fixed time derived from the returned `handoffExpiresAt` and clears the buffer; `canceled` or `gone` shows that terminal state and clears the buffer; `pending` keeps the buffer. If the connection dropped during a send, the card reads status before any further send. Per the server rule (step 3), a repeat submit of a delivered request returns the same `handoffExpiresAt` and writes no second file, so a lost response recovers without a second delivery.
10. **RPC error.** Failed send: the value is kept, a danger notice shows the server `message` (fallback copy), and Send stays enabled, so pressing it again is the retry. For `request-canceled` or `request-gone` the card clears the buffer and invalidates the status query, which moves it to `canceled` or `gone`.
11. **Unavailable.** `secrets.submit` returns `{status:"unavailable", message}` when the handoff write fails. The server uses this for any handoff write failure, including a full or read-only mount, not only a missing RAM mount. The buffer is cleared, the input is removed, and the card becomes a read-only danger notice with no retry. The plugin normally refuses such requests before rendering any card, so this covers a condition that appears after the card is on screen.
12. **Idle.** Pending with no input for 5 minutes: buffer cleared, idle notice shown. The field accepts typing again.
13. **Unmount and remount.** Unmount drops the buffer. A remount (for example, a virtualized list scrolling the card out and back) starts with an empty field. Nothing is persisted. The request remains pending on the server.
14. **No replace, no re-entry.** The card has no replace action and never prefills an earlier value. If the agent needs a value again, it calls `request_secret` again and gets a new card with an empty field.
15. **Handoff file lifetime.** The file at `/dev/shm/paseo-<uid>-secret-request/<handoffId>/<requestId>` is removed by TTL expiry (15 minutes after delivery), agent archive, or plugin start. A plugin reload restarts the plugin, which performs that same start purge. `secrets.cancel` removes nothing, because a canceled request never had a file. The agent cannot delete the file early: `request_secret` is the only MCP tool. `data` carries no deadline. The card learns `handoffExpiresAt` only from the submit result or `secrets.status`.

## 2. Every state

Columns: **Card** = rendered content. **Input** = field. **Send** / **Cancel** = buttons. Only one lifecycle state is shown at a time; `offline` and `rpcError` overlay `pending-*`. Terminal states (`delivered`, `canceled`, `gone`, `unavailable`) remove the `TextInput` from the tree, so no text can be read from a hidden field.

| State            | Trigger                                          | Card shows                                                                                                                                                                                                                       | Input                          | Send                 | Cancel   |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------- | -------- |
| `pending-empty`  | Request received, no text                        | Headline, label, description, hint, request id, wait line, placeholder                                                                                                                                                           | editable, masked               | disabled             | enabled  |
| `pending-filled` | Text present                                     | Same; Send enabled                                                                                                                                                                                                               | editable, masked               | enabled              | enabled  |
| `sending`        | `secrets.submit` in flight                       | Spinner beside Send; "Sending…"                                                                                                                                                                                                  | non-editable                   | busy, disabled       | disabled |
| `delivered`      | Submit returned `status: "delivered"`            | Success tone bar; "Passed to your agent; held in a RAM-backed file, deleted automatically by {time}", where {time} is the fixed local time from `handoffExpiresAt`; "The agent receives a file path it can read, not the value." | removed                        | removed              | removed  |
| `canceled`       | Cancel succeeded, or `status: "canceled"`        | Muted tone bar; headline only                                                                                                                                                                                                    | removed                        | removed              | removed  |
| `gone`           | Status read or submit fails with `request-gone`  | Muted tone bar; headline only                                                                                                                                                                                                    | removed; buffer cleared        | removed              | removed  |
| `unavailable`    | `secrets.submit` returns `status: "unavailable"` | Read-only danger tone bar; "The value could not be handed over safely" plus the server message (fallback copy); no retry                                                                                                         | removed; buffer cleared        | removed              | removed  |
| `rpcError`       | Submit failed while still pending                | Danger notice with server message (fallback copy); value kept                                                                                                                                                                    | editable, value kept           | enabled if non-empty | enabled  |
| `offline`        | Host connection lost                             | Warning banner "Paseo is offline. Reconnect to send."                                                                                                                                                                            | editable, value kept in buffer | disabled             | disabled |
| `idle-cleared`   | 5 minutes without input while pending            | "Cleared after inactivity. Type it again."                                                                                                                                                                                       | editable, empty                | disabled             | enabled  |

Rules:

- `sending` disables every control, so a double tap cannot send twice.
- An `rpcError` from `request-canceled` or `request-gone` is terminal: the card clears the buffer and invalidates the status query, which moves it to `canceled` or `gone`. Other failures keep the value and leave Send enabled.
- On reconnect, the status read decides the state: `delivered` shows the delivered state with the fixed time from `handoffExpiresAt` and clears the buffer; `canceled` or `gone` shows that terminal state and clears the buffer; `pending` keeps the buffer.
- `delivered` does not show the file path. The path is not secret, but the card has no use for it, and it stays out of the rendered tree.

## 3. Component tree

Props that matter are listed after the component name. `theme` and `layout` come from the host; `host.id` scopes RPC and query keys.

```
SecretRequestCard                         props: agentId, item, timestamp, theme, layout, host
└─ View (testID="secret-request-card")    card surface, tone bar, gap 12
   ├─ View (row)                          flexDirection row, gap 10
   │  ├─ View (tone bar, decorative)      accessibilityElementsHidden; color from status tone
   │  └─ View (column, flex 1, minWidth 0)
   │     ├─ View (status)                 testID="secret-request-status"
   │     │  └─ Text (headline)            testID="secret-request-headline", 16/22 600, live region polite
   │     ├─ Text (label)                  testID="secret-request-label", accessibilityRole="header", data.label (free text)
   │     ├─ Text (description)            testID="secret-request-description", optional
   │     ├─ Text (hint)                   testID="secret-request-hint", optional, data.hint
   │     └─ View (meta row)
   │        ├─ Mono (request id)          testID="secret-request-id", selectable, data.requestId
   │        └─ Text (wait line)           testID="secret-request-wait", "Waiting {elapsed} min", pending and sending only
   ├─ [status === "pending" && phase !== "unavailable"] View (form)
   │  ├─ Text (field label)               "Value", nativeID for label association
   │  ├─ View (input row)
   │  │  └─ TextInput                     testID="secret-request-input"
   │  │                                   secureTextEntry (always), autoCapitalize="none",
   │  │                                   autoCorrect={false}, autoComplete="off", spellCheck={false},
   │  │                                   textContentType="none", importantForAutofill="no",
   │  │                                   editable={!sending} (offline keeps it editable),
   │  │                                   returnKeyType="done", onChangeText, onSubmitEditing,
   │  │                                   accessibilityLabel from copy field.a11yLabel
   │  ├─ Text (idle)                      testID="secret-request-idle", only after 5 minutes idle
   │  ├─ Text (field note)                testID="secret-request-field-note", pending only
   │  └─ View (actions row)
   │     ├─ Pressable (Cancel)            testID="secret-request-cancel", variant secondary, accessibilityRole="button"
   │     └─ Pressable (Send)              testID="secret-request-submit", variant primary, accessibilityState {disabled, busy}
   ├─ [status === "delivered"] View (result)
   │  ├─ Text (note)                      testID="secret-request-delivered", success color, live region polite; delivered.note with the fixed local time, rendered once
   │  └─ Text (path note)                 testID="secret-request-delivered-note", "The agent receives a file path it can read, not the value."
   ├─ [status === "canceled" | "gone"]    headline only; no extra terminal line
   ├─ [phase === "unavailable"] Notice (danger, role alert)
   │  ├─ Text (title)                     testID="secret-request-unavailable", generic title (copy.unavailable.title)
   │  └─ Text (server message)            testID="secret-request-unavailable-message", fallback copy
   ├─ [offline] Notice (warning)          testID="secret-request-offline"
   └─ [phase === "rpcError"] Notice (danger, role alert)
      └─ Text (server message)            testID="secret-request-error"
```

Notes:

- `data.label` is free text. It is rendered as plain text and never used as an identifier, a URL, a path, or a shell argument.
- The monospace element shows only `requestId`. No variable name appears anywhere on the card.
- The card does not render a reveal control, a copy button, or a character counter.
- `Notice` and the button and banner styles are copied locally from the devenv pattern. Each plugin stays independently installable.
- `data.status` has three values: `pending`, `delivered`, `canceled`. `gone` is client-derived from a status read that fails with `request-gone`. `sending`, `rpcError` and `unavailable` are card-local `phase` values; `offline` is derived from a failing status query.
- `secret-request-spinner` is the ActivityIndicator inside Send while sending.
- The card needs no clock for the delivered state; the only timer is the 30-second interval for the wait line and the idle check.

### Copy: English and Simplified Chinese

Strings use `{label}`, `{time}`, `{elapsed}`, `{id}`, and `{message}` placeholders. Chinese copy calls the agent "Bot", following the delivered-note wording. Locale comes from the device (`Intl`), with English as fallback; any `zh*` locale uses Simplified Chinese.

| Key                    | English                                                                          | 简体中文                                                  |
| ---------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `headline.pending`     | Secret requested                                                                 | 需要提供密钥                                              |
| `headline.sending`     | Sending secret…                                                                  | 正在发送密钥…                                             |
| `headline.delivered`   | Secret delivered                                                                 | 密钥已交付                                                |
| `headline.canceled`    | Request canceled                                                                 | 请求已取消                                                |
| `headline.gone`        | Request interrupted                                                              | 请求已中断                                                |
| `headline.unavailable` | Cannot hand over the value                                                       | 无法交接密钥                                              |
| `field.label`          | Value                                                                            | 值                                                        |
| `field.note`           | Typed text is hidden and never added to the chat.                                | 输入内容已隐藏，不会加入聊天记录。                        |
| `field.a11yLabel`      | Secret value for {label}                                                         | {label} 的密钥值                                          |
| `field.placeholder`    | Paste or type the value                                                          | 粘贴或输入该值                                            |
| `meta.wait`            | Waiting {elapsed} min                                                            | 已等待 {elapsed} 分钟                                     |
| `action.send`          | Send to agent                                                                    | 发送给 Bot                                                |
| `action.sending`       | Sending…                                                                         | 发送中…                                                   |
| `action.cancel`        | Cancel                                                                           | 取消                                                      |
| `idle`                 | Cleared after inactivity. Type it again.                                         | 因长时间未操作已清空。请重新输入。                        |
| `delivered.note`       | Passed to your agent; held in a RAM-backed file, deleted automatically by {time} | 已安全传递给你的 Bot，保存在内存盘文件中，{time} 自动清除 |
| `delivered.path`       | The agent receives a file path it can read, not the value.                       | Bot 收到的是可读取的文件路径，而不是值本身。              |
| `unavailable.title`    | The value could not be handed over safely                                        | 无法安全交接密钥                                          |
| `unavailable.fallback` | The value was not sent and was not stored.                                       | 未发送，也未保存该值。                                    |
| `offline`              | Paseo is offline. Reconnect to send.                                             | Paseo 已离线。重新连接后即可发送。                        |
| `error.generic`        | The value could not be sent. Your input is kept.                                 | 无法发送，输入内容已保留。                                |
| `a11y.card`            | Secret request: {label}                                                          | 密钥请求：{label}                                         |

Copy rules:

- Copy never repeats the value's characters.
- Error copy uses the server `message` when present, otherwise `error.generic` or `unavailable.fallback`. Raw payloads are never rendered.
- The `{label}` placeholder is user-supplied text. It is inserted as a plain string, never as markup.

## 4. Visual spec

### Tokens

- Card: `surface1` background, 1px `border`, 12px radius, 3px left rule in the status tone (same pattern as devenv `Notice`). Padding 16 desktop, 12 compact. Gap 12.
- Field: `surface2` background, 1px `border`, 6px radius, 48px minimum height on compact and native, 44px on desktop web. Horizontal padding 12. Font 16 on native so iOS does not zoom.
- Send: `accent` background, `accentForeground` text, 600 weight, 44px minimum height. Cancel: `surface1` background, 1px `border`, `foreground` text, 44px minimum height. Disabled controls use opacity 0.5.
- Headline: 16/22, 600, `foreground`. Label: 14/20, 600, `foreground`. Description and hint: 13/19, `foregroundMuted`. Meta: 12/17, `foregroundMuted`.
- Delivered note: 13/19, `statusSuccess`, rendered once with a fixed time. No tabular or ticking countdown.
- Tone by state: `pending`, `sending`: `accent`. `delivered`: `statusSuccess`. `canceled`, `gone`: `foregroundMuted`. `unavailable`, `rpcError`: `statusDanger`. `offline`: `statusWarning`.
- Compact (`layout.compact` true): card padding 12, buttons full width stacked, Send above Cancel. Desktop: buttons in a row, Cancel left of Send, `maxWidth` 560.

### Hierarchy

Headline first (state), then label (what is being asked for), then description (why), then the request's hint if set (where to find the value), then meta (request id, wait), then the field and actions. The label is the only thing the user needs to recognise the request; the request id is for support and log correlation only.

### Distinct from a chat message

The card is a bordered surface with a tone rule, a state headline and interactive controls. Chat messages are unbordered text without fields or buttons. The card does not use a speech bubble or an author avatar, so it does not look like the agent said it.

### Indicating a secret field

- Field label "Value" sits above the field.
- The field shows masked dots (`secureTextEntry`) and nothing else.
- A helper line under the field reads "Typed text is hidden and never added to the chat." It is shown in `pending-*` states only.
- No lock glyph or colour-only signal. The text carries the meaning.

### Masked vs revealed

The field is always masked. There is no show/hide control, no reveal long-press, and no copy-to-clipboard control. The card shows no character count; the masked rendering comes from the platform and disappears on send.

### After successful send

The field and both buttons are removed. The card shows:

1. Headline "Secret delivered".
2. Label (for example "测试密码"), so the user sees which request was answered.
3. The delivered note: "Passed to your agent; held in a RAM-backed file, deleted automatically by 14:52".
4. "The agent receives a file path it can read, not the value."

The card has no countdown and does not tick. The deadline is one fixed local time, rendered once. The card cannot verify deletion, so it does not claim it. The value does not appear anywhere on the card, and neither does the file path.

### Wireframes

Desktop, pending:

```text
┌────────────────────────────────────────────────────────────┐
│▌ Secret requested                                          │
│▌ Test password                                             │
│▌ Used for the staging login test.                          │
│▌ Hint: check the staging entry in your password manager.   │
│▌ req_7f3a   Waiting 2 min                                  │
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
│▌ Passed to your agent; held in a RAM-backed file, deleted  │
│▌ automatically by 14:52                                    │
│▌ The agent receives a file path it can read, not the value.│
│▌ req_7f3a                                                  │
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

- **Keyboard and autofill.** `secureTextEntry`, `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="off"`, `spellCheck={false}`, `textContentType="none"`, `importantForAutofill="no"`. Suggestions and autofill are suppressed where the platform honours them; third-party keyboards may still learn from input, which the card cannot control. The helper line says only that typed text is hidden, not that it is never stored by the keyboard.
- **Paste.** Allowed. The card never reads the clipboard itself, so no clipboard permission is needed and no paste button exists.
- **Newline handling.** Newlines cannot be entered into the masked field, and the card does not try to preserve them. The plugin stores the trimmed value exactly as received. A PEM key pasted into the field arrives without line breaks; the agent or server is responsible for detecting that and asking for a corrected value. The card does not reformat, re-wrap, detect key types, or base64-encode.
- **Trim consequences.** Trimming removes spaces at the ends of the value only. A pasted key therefore reaches the plugin without a trailing newline, and the plugin does not add one. The agent decides how to handle a key that arrives without line breaks.
- **No show/hide.** Removed. Reveal would put cleartext on screen, where screenshots, screen sharing, shoulder-surfing and screen recorders can capture it. It would also add a second state to test.
- **Read-back after send.** Never. The card does not read the `TextInput` after send, and does not read it back into state. The value is passed once to `secrets.submit`.
- **Buffer ownership.** The typed value lives only in a ref and the uncontrolled `TextInput`. It is never in React state, props, query data, or mutation variables. The send path reads the ref at call time. The ref is cleared on send, cancel, unmount, `gone`, `unavailable`, idle clearing, and any terminal status read. On `rpcError` the buffer is kept so the user can resend. JavaScript strings cannot be zeroed; the card drops its references and renders nothing from them.
- **Unmount.** Clears the buffer ref and does not call any RPC. A send in flight at unmount completes on the server; the component ignores its result and sets no state. The value is not persisted to storage, route params, or any cache.
- **Logging and telemetry.** The value never goes into props, timeline `data`, query keys, analytics, error reporters, or `console`. RPC payloads are not logged by the card. Errors are rendered from `message` only.
- **Permanent transcript form.** The transcript keeps the request label, request id, and the delivered note. It never keeps the value, the handoff file path, or any prefix. A screenshot of a delivered card contains no secret material. A screenshot of a pending card contains the masked dots, which show the platform's masked rendering and nothing else.
- **Value residency.** The value sits in a `0600` file on a RAM-backed tmpfs at `/dev/shm`, and in JavaScript strings that cannot be zeroed. On a host with unencrypted swap, tmpfs pages can be written to swap, so the value can reach disk. The delivered note says the file is RAM-backed and deleted by a fixed time; it does not claim the value never touches disk.
- **Handoff lifetime.** The file is removed by TTL expiry (15 minutes after delivery), agent archive, or plugin start. A plugin reload restarts the plugin, which performs that same start purge. `secrets.cancel` removes nothing, because a canceled request never had a file. The agent cannot delete the file early: `request_secret` is the only MCP tool.
- **Daemon restart while waiting.** The blocked call cannot survive a restart. A status read after restart fails with `request-gone`, and the card shows the `gone` state. The card does not infer a canceled outcome.
- **Non-secret identifiers.** Only `requestId` is shown as an identifier. `label` is free text, rendered as plain text, never used as a key, path or URL.
- **Typing.** No `as` assertions, no non-null assertions, no comments in source.

## 6. E2E-selectable surface

Playwright targets `testID`s through React Native Web, which renders `testID` as `data-testid`. Roles are asserted with `getByRole`, names with `getByRole(..., {name})`, and text with `toHaveText` on the `testID` element. Assertions check visible feedback only, never the typed value. The E2E harness reads the plugin's port and the bearer token bound to its test agent from `state.json` under `PASEO_HOME/plugin-data/secret-request/`.

| testID                               | Role / name                                  | Present in states                 | Asserted feedback                                                                                                                                     |
| ------------------------------------ | -------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secret-request-card`                | region, name = `copy.a11y.card(label)`       | all                               | visible; contains label text                                                                                                                          |
| `secret-request-status`              | —                                            | all                               | wraps the headline                                                                                                                                    |
| `secret-request-headline`            | live polite                                  | all                               | text equals headline for the state (see section 2)                                                                                                    |
| `secret-request-label`               | heading                                      | all                               | text equals `data.label`                                                                                                                              |
| `secret-request-description`         | —                                            | when `description` set            | text equals `data.description`                                                                                                                        |
| `secret-request-hint`                | —                                            | when `data.hint` set              | text equals `data.hint`                                                                                                                               |
| `secret-request-id`                  | —                                            | all                               | text equals `requestId`                                                                                                                               |
| `secret-request-wait`                | —                                            | `pending-*`, `sending`            | text matches `/^Waiting \d+ min$/`; minutes do not decrease across refresh                                                                            |
| `secret-request-input`               | textbox, name = `Secret value for {label}`   | `pending-*`, `sending` (disabled) | `secureTextEntry` on native; `type="password"` on web; `editable` false during `sending`; absent after `delivered`, `canceled`, `gone`, `unavailable` |
| `secret-request-field-note`          | —                                            | `pending-*`                       | "Typed text is hidden and never added to the chat."                                                                                                   |
| `secret-request-idle`                | —                                            | `idle-cleared`                    | text "Cleared after inactivity. Type it again."                                                                                                       |
| `secret-request-submit`              | button, name = "Send to agent" or "Sending…" | `pending-*`, `sending`            | disabled and `aria-disabled="true"` when empty, `sending`, offline; `aria-busy="true"` while sending                                                  |
| `secret-request-spinner`             | —                                            | `sending`                         | visible while sending; absent otherwise                                                                                                               |
| `secret-request-cancel`              | button, name = "Cancel"                      | `pending-*`, `sending` (disabled) | enabled in `pending-*`; after click the headline reads "Request canceled"                                                                             |
| `secret-request-delivered`           | live polite                                  | `delivered`                       | text contains "held in a RAM-backed file, deleted automatically by" followed by a fixed local time; the time does not change on re-render             |
| `secret-request-delivered-note`      | —                                            | `delivered`                       | text equals "The agent receives a file path it can read, not the value."                                                                              |
| `secret-request-unavailable`         | —                                            | `unavailable`                     | text equals `unavailable.title`                                                                                                                       |
| `secret-request-unavailable-message` | —                                            | `unavailable`                     | text equals server message, or fallback when empty                                                                                                    |
| `secret-request-error`               | role alert                                   | `rpcError`                        | text equals server message or generic copy; Send stays enabled when text is present                                                                   |
| `secret-request-offline`             | —                                            | offline                           | text "Paseo is offline. Reconnect to send."                                                                                                           |

Tests to write as real E2E (no mocks of the plugin host, transport or RPC):

- Send with a valid value: field disappears, `secret-request-delivered` appears with the fixed deadline, `secret-request-input` is absent, and no element on the page contains the typed string.
- Empty input: Send is disabled, pressing Return does nothing, and no RPC is issued.
- Padded value: the RPC receives the trimmed value; interior spaces are kept byte-for-byte.
- Cancel: `secret-request-headline` reads "Request canceled"; the agent-side tool call returns `{status:"canceled"}`.
- Unavailable: `secret-request-unavailable` shows the generic title and `secret-request-unavailable-message` shows the server message; no retry control exists.
- Failed send: the typed value stays in the field, `secret-request-error` appears, and Send remains enabled so the same action retries.
- Offline: `secret-request-offline` appears; send and cancel are disabled; reconnect restores the editable field.
- Compact viewport (390 px): Send sits above Cancel and both are at least 44 px tall.
- Light and dark themes: the tone rule colour matches the `theme.colors` mapping for the state.
- `gone`: the headline reads "Request interrupted"; the input is absent and Send and Cancel do not render.
- Second submit of a delivered request returns the same `handoffExpiresAt` without a second file; a submit of a canceled request fails with `request-canceled` and the card shows the `canceled` state after a status read.

Negative assertions for every state: no element with a `testID` in this list displays the typed value or the handoff file path, and the delivered deadline appears only in the static delivered note.
