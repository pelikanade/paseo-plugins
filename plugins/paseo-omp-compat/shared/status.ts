import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const directiveStates = [
  "builtin",
  "override",
  "present",
  "disabled",
] as const;
export const directiveStateSchema = z.enum(directiveStates);
export type DirectiveState = z.infer<typeof directiveStateSchema>;

export const STATE_ENV_KEY = "PASEO_OMP_COMPAT_STATE";

export function parseState(value: string | undefined): DirectiveState | null {
  const parsed = directiveStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const statusSchema = z.object({
  enabled: z.boolean(),
  state: directiveStateSchema.nullable(),
});
export type StatusView = z.infer<typeof statusSchema>;

export const statusRpc = defineRpc({
  name: "paseo-omp-compat.status",
  input: z.object({ agentId: z.string().min(1) }).strict(),
  output: statusSchema,
});

export function describeState(view: StatusView): {
  active: boolean | null;
  headline: string;
  detail: string;
} {
  switch (view.state) {
    case "builtin":
      return {
        active: true,
        headline: "Paseo first directive: active",
        detail: "Text source: built-in directive.",
      };
    case "override":
      return {
        active: true,
        headline: "Paseo first directive: active",
        detail: "Text source: textOverride from plugin settings.",
      };
    case "present":
      return {
        active: true,
        headline: "Paseo first directive: active",
        detail:
          "Text source: already present in the system prompt requested for this agent; the plugin did not append it again.",
      };
    case "disabled":
      return {
        active: false,
        headline: "Paseo first directive: not applied",
        detail:
          "The plugin was disabled in its settings when this agent was created.",
      };
    case null:
      return {
        active: null,
        headline: "Paseo first directive: unknown",
        detail:
          "No creation record for this agent in the running daemon. It predates the plugin, was created while it was not installed, or the daemon restarted after creation.",
      };
  }
}
