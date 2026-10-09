import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.iso.datetime();

export const providerChoiceSchema = z
  .object({
    provider: identifierSchema,
    model: identifierSchema.nullable(),
  })
  .strict();
export type ProviderChoice = z.infer<typeof providerChoiceSchema>;

export const pluginDefaultsSchema = z
  .object({
    automaticStarts: z.boolean(),
    agent: providerChoiceSchema.nullable(),
  })
  .strict();
export type PluginDefaults = z.infer<typeof pluginDefaultsSchema>;

const repositorySchema = z
  .object({
    owner: identifierSchema,
    name: identifierSchema,
  })
  .strict();

export const workflowLabels = {
  backlog: "stack:backlog",
  ready: "stack:ready",
  building: "stack:in-progress",
  reviewing: "stack:in-review",
  mergeQueue: "stack:merge-queue",
  needsYou: "stack:hitl",
  done: "stack:done",
} as const;

export const bindingSchema = z
  .object({
    workspaceId: identifierSchema,
    repository: repositorySchema,
    paused: z.boolean(),
    checkEverySeconds: z.number().int().min(10).max(86_400),
    repairEverySeconds: z.number().int().min(60).max(604_800).nullable(),
    agent: providerChoiceSchema.nullable(),
  })
  .strict();
export type Binding = z.infer<typeof bindingSchema>;

export const signalKindSchema = z.enum([
  "ready",
  "pr_opened",
  "pr_updated",
  "pr_merged",
  "pr_closed",
  "ci",
  "human_feedback",
  "command",
  "repair",
]);
export type SignalKind = z.infer<typeof signalKindSchema>;

export const githubProblemSchema = z
  .object({
    kind: z.enum(["authentication", "permission"]),
    hostname: z.string(),
    message: z.string(),
  })
  .strict();
export type GitHubProblem = z.infer<typeof githubProblemSchema>;

export const healthSchema = z
  .object({
    state: z.enum(["waiting", "connected", "checking", "error"]),
    message: z.string(),
    githubProblem: githubProblemSchema.nullable().default(null),
    login: z.string().nullable(),
    lastCheckedAt: timestampSchema.nullable(),
    nextCheckAt: timestampSchema.nullable(),
  })
  .strict();

export const countsSchema = z
  .object({
    ready: z.number().int().nonnegative(),
    building: z.number().int().nonnegative(),
    reviewing: z.number().int().nonnegative(),
    mergeQueue: z.number().int().nonnegative(),
    needsYou: z.number().int().nonnegative(),
  })
  .strict();

export const attentionSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    status: z.enum(["merge_queue", "needs_you"]),
    detail: z.string(),
    url: z.url(),
  })
  .strict();

export const activitySchema = z
  .object({
    id: identifierSchema,
    at: timestampSchema,
    kind: z.enum(["observed", "started", "handled", "error", "repair"]),
    message: z.string(),
    url: z.url().nullable(),
  })
  .strict();
export type Activity = z.infer<typeof activitySchema>;

export const providerOptionSchema = z
  .object({
    provider: identifierSchema,
    model: identifierSchema.nullable(),
    label: z.string(),
    supportsFullAccess: z.boolean(),
  })
  .strict();

export const panelStateSchema = z
  .object({
    status: z.enum(["unbound", "watching", "paused", "error"]),
    defaults: pluginDefaultsSchema,
    binding: bindingSchema.nullable(),
    health: healthSchema,
    counts: countsSchema,
    attention: z.array(attentionSchema),
    activity: z.array(activitySchema),
    providerOptions: z.array(providerOptionSchema),
  })
  .strict();
export type PanelState = z.infer<typeof panelStateSchema>;

export const panelRpc = defineRpc({
  name: "nstack.panel",
  input: z.object({ workspaceId: identifierSchema }).strict(),
  output: panelStateSchema,
});

export const saveSettingsRpc = defineRpc({
  name: "nstack.settings.save",
  input: z
    .object({
      workspaceId: identifierSchema,
      defaults: pluginDefaultsSchema,
      binding: bindingSchema.nullable(),
    })
    .strict(),
  output: panelStateSchema,
});

export const testConnectionRpc = defineRpc({
  name: "nstack.connection.test",
  input: z
    .object({
      workspaceId: identifierSchema,
      defaults: pluginDefaultsSchema,
      binding: bindingSchema,
    })
    .strict(),
  output: z
    .object({
      ok: z.boolean(),
      login: z.string().nullable(),
      message: z.string(),
      githubProblem: githubProblemSchema.nullable(),
    })
    .strict(),
});

export const setPauseRpc = defineRpc({
  name: "nstack.pause.set",
  input: z.discriminatedUnion("scope", [
    z
      .object({
        scope: z.literal("all"),
        workspaceId: identifierSchema,
        paused: z.boolean(),
      })
      .strict(),
    z
      .object({
        scope: z.literal("workspace"),
        workspaceId: identifierSchema,
        paused: z.boolean(),
      })
      .strict(),
  ]),
  output: panelStateSchema,
});

export const checkNowRpc = defineRpc({
  name: "nstack.check.now",
  input: z.object({ workspaceId: identifierSchema }).strict(),
  output: z
    .object({
      observed: z.number().int().nonnegative(),
      started: z.number().int().nonnegative(),
      handled: z.number().int().nonnegative(),
      errors: z.number().int().nonnegative(),
    })
    .strict(),
});

export const startedNoticeSchema = z
  .object({
    workspaceId: identifierSchema,
    repository: z.string(),
    signalKind: signalKindSchema,
    subject: z.string(),
    url: z.url().nullable(),
    observedAt: timestampSchema,
  })
  .strict();
export type StartedNotice = z.infer<typeof startedNoticeSchema>;
