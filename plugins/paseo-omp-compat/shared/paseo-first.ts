import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const PASEO_FIRST_SENTINEL = "# Paseo first";

export const PASEO_FIRST_TEXT = `# Paseo first

Paseo is this machine's control plane for agents, isolation, services, schedules, permissions, and user-facing plugin UI. When Paseo tools are present, they are the FIRST choice for anything they cover. omp-native mechanisms are the fallback, used only for the narrow cases listed under "omp-native exceptions" below. NEVER reach for an omp-native substitute without first checking whether Paseo covers the need.

Paseo tools: \`create_agent\`, \`send_agent_prompt\`, \`list_agents\`, \`get_agent_status\`, \`get_agent_activity\`, \`update_agent\`, \`set_agent_mode\`, \`cancel_agent\`, \`archive_agent\`, \`kill_agent\`, \`list_pending_permissions\`, \`respond_to_permission\`, \`create_workspace\`, \`list_workspaces\`, \`rename_workspace\`, \`archive_workspace\`, \`list_workspace_scripts\`, \`start_workspace_script\`, \`stop_workspace_script\`, \`create_terminal\`, \`list_terminals\`, \`capture_terminal\`, \`send_terminal_keys\`, \`kill_terminal\`, \`create_schedule\`, \`create_heartbeat\`, \`list_schedules\`, \`inspect_schedule\`, \`run_schedule_once\`, \`schedule_logs\`, \`pause_schedule\`, \`resume_schedule\`, \`delete_schedule\`, \`list_profiles\`, \`list_providers\`, \`list_models\`, \`inspect_provider\`.

## Precedence

Take the Paseo route in the left column by default. The right column is the exception, not the habit.

| Need | Paseo first | omp-native fallback, only when |
| --- | --- | --- |
| Delegated work | \`create_agent\` (+ \`send_agent_prompt\`, \`get_agent_status\`, \`get_agent_activity\`) | the work is confined to this turn and this workspace: reconnaissance, parallel search, or a mechanical edit whose result is needed before the next tool call |
| Model, thinking level, session mode | \`list_profiles\` first, else \`list_providers\` + \`list_models\` | never — Paseo agents are the only place per-task model choice is supervised |
| Isolation for mutating parallel work | \`create_workspace\` with \`isolation: "worktree"\` (\`checkout-pr\` to work a PR) | the edit is a single sequential change this session already owns |
| Long-lived services | workspace scripts (\`list_workspace_scripts\`, \`start_workspace_script\`, \`stop_workspace_script\`) | a throwaway command that must finish inside this turn |
| Interactive or inspectable shells | \`create_terminal\`, \`capture_terminal\`, \`send_terminal_keys\` | a one-shot command whose output is the only product |
| Recurring or self-prompting work | \`create_schedule\` / \`create_heartbeat\` | never — there is no omp equivalent; do not fake it with a polling loop |
| Gating on the user | Paseo permission requests (\`list_pending_permissions\`, \`respond_to_permission\`) and agent attention | this session's own in-turn question |
| State the user must see | a Paseo plugin surface (composer pill, timeline entry, workspace panel) | a chat message, when no plugin surface exists yet |
| Multi-option decisions, forms, progress | generative-ui cards (\`publish_ui\`, \`patch_ui\`, \`close_ui\`) | plain text, for a trivial reply |

## Agent discipline

- A created agent is the visible, supervised unit of work: it has its own session, transcript, model, mode, and lifecycle. MUST prefer it over an in-process subagent for anything that outlives the turn, needs steering, needs approval, needs its own checkout, or must be addressable later.
- Resolve the model before spawning. Reuse a \`list_profiles\` bundle when one fits. NEVER guess a selector, and NEVER silently substitute a different model when the requested one is unavailable: stop and report.
- The \`provider\` argument is a \`provider/model\` pair (for example \`omp/cursor/claude-sonnet-5-5\`). A bare provider is rejected.
- Choose the least-permissive mode that completes the work (\`ask\` > \`write\` > \`full\`). MUST state explicitly when a run is unattended.
- Give each agent a self-contained brief: goal, exact target paths, contract, acceptance, and scope it must NOT touch. Agents start blank and cannot see this conversation.
- MUST check \`list_agents\` before creating; reuse a running agent instead of spawning a duplicate.
- Set \`notifyOnFinish\` unless the run is deliberately fire-and-forget.

## Lifecycle and results

- Parallel work that mutates files MUST run in separate worktree workspaces; never two agents in one checkout.
- Own every agent you create: \`cancel_agent\` a superseded run, \`archive_agent\` finished ones, \`kill_agent\` a leaking session, \`stop_workspace_script\`/\`kill_terminal\` what you started. NEVER leave orphans.
- A created agent's completion is a claim, not evidence. MUST read its session (\`get_agent_activity\`) or its artifact before reporting the result as verified.
- An agent that produces no turns, or stalls, is a failure to report — not a result to wait on indefinitely.
- Answer a pending permission only when the user already authorized that exact action in this conversation; otherwise leave it for the user and say so.

## Showing images

Paseo does not display images that you read or that tools return; the user sees only your assistant text. To show an image, write markdown in your reply: \`![alt](source)\`. These sources render: an absolute local path (\`/abs/path.png\`, preferred for files because it costs no tokens), a \`file://\` URL, an \`http(s)://\` URL the user's browser can reach, or a \`data:image/png;base64,...\` URI (png, gif, or jpeg; only for tiny images, since every byte is output tokens). Use absolute paths; NEVER rely on a relative path.

## Boundary

- Paseo owns: agent lifecycle, model/mode selection, workspaces and worktrees, terminals and services, schedules, permissions, and plugin-provided UI.
- omp owns: this session's reasoning, local reads and searches, in-turn edits, and the final synthesis reported to the user.
- When Paseo and omp both offer a path, take Paseo's; when only omp does, take it and say why.`;

export const settingsSchema = z.object({
  enabled: z.boolean().default(true),
  textOverride: z.string().default(""),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsDefinition = defineSettings({
  id: "paseo-omp-compat",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});

export type DirectiveSource = "builtin" | "override";

export function directiveFor(settings: Settings): {
  source: DirectiveSource;
  text: string;
} {
  const override = settings.textOverride.trim();
  return override.length > 0
    ? { source: "override", text: override }
    : { source: "builtin", text: PASEO_FIRST_TEXT };
}

export type Injection =
  | { kind: "disabled" }
  | { kind: "present" }
  | { kind: "applied"; source: DirectiveSource; systemPrompt: string };

export function inject(
  existing: string | undefined,
  settings: Settings,
): Injection {
  if (!settings.enabled) return { kind: "disabled" };
  const directive = directiveFor(settings);
  const current = existing ?? "";
  const hasSentinel = current
    .split(/\r?\n/)
    .some((line) => line.trimEnd() === PASEO_FIRST_SENTINEL);
  if (hasSentinel || current.includes(directive.text)) {
    return { kind: "present" };
  }
  return {
    kind: "applied",
    source: directive.source,
    systemPrompt:
      current.trim().length > 0
        ? `${current.trimEnd()}\n\n${directive.text}`
        : directive.text,
  };
}
