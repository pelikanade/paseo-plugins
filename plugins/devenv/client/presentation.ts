import type { PluginTheme } from "@getpaseo/plugin";
import type { StatusView } from "../shared/contracts";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export const toneColors = {
  neutral: "foregroundMuted",
  accent: "accent",
  success: "statusSuccess",
  warning: "statusWarning",
  danger: "statusDanger",
} satisfies Record<Tone, keyof PluginTheme["colors"]>;

interface Presentation {
  tone: Tone;
  headline: string;
  summary: string;
}

export function describe(view: StatusView | undefined): Presentation {
  if (!view)
    return {
      tone: "neutral",
      headline: "Loading devenv status…",
      summary: "",
    };
  if (view.needsReload)
    return {
      tone: "warning",
      headline: "Reload required",
      summary:
        view.status === "loading"
          ? "An updated environment is preparing. This session still uses its previous environment."
          : view.status === "error"
            ? "Environment preparation failed. This session still uses its previous environment."
            : view.status === "denied"
              ? "Project trust was revoked. This session still uses its previous environment."
              : view.status === null
                ? "The project is no longer available. This session still uses its previous environment."
                : view.applied
                  ? "The project environment has changed since this session started."
                  : "The prepared environment is ready to apply to this session.",
    };
  if (view.applied)
    return {
      tone: "success",
      headline: "Environment applied",
      summary: "This agent is running with the project environment.",
    };
  switch (view.status) {
    case "denied":
      return {
        tone: "warning",
        headline: "Project not trusted",
        summary:
          "devenv will not run this project’s configuration until you allow it.",
      };
    case "detected":
      return {
        tone: "accent",
        headline: "Project detected",
        summary:
          "devenv.nix found. The current environment has not been prepared yet.",
      };
    case "loading":
      return {
        tone: "accent",
        headline: "Preparing environment",
        summary:
          "devenv is building this project’s environment. Status updates automatically.",
      };
    case "ready":
      return {
        tone: "accent",
        headline: "Environment prepared",
        summary:
          "The project environment is prepared. It has not been applied to this agent’s session.",
      };
    case "error":
      return {
        tone: "danger",
        headline: "Environment failed",
        summary: "The project environment could not be prepared.",
      };
    case null:
      return {
        tone: "neutral",
        headline: "No devenv project",
        summary:
          "No devenv.nix found in this agent’s directory or its ancestors.",
      };
  }
}
