import { z } from "zod";
import artifact from "./model.generated.mjs";

const profileSchema = z.object({ $: z.literal("Profile"), path: z.string() });
const loadSchema = z.discriminatedUnion("$", [
  z.object({ $: z.literal("Unloaded") }),
  z.object({ $: z.literal("InFlight") }),
  z.object({ $: z.literal("Loaded"), profile: profileSchema }),
  z.object({ $: z.literal("Failed") }),
]);
const stateSchema = z.discriminatedUnion("$", [
  z.object({ $: z.literal("Untrusted") }),
  z.object({ $: z.literal("Trusted"), load: loadSchema }),
]);
const decisionSchema = z.discriminatedUnion("$", [
  z.object({ $: z.literal("Skip") }),
  z.object({ $: z.literal("Give"), profile: profileSchema }),
]);
const applicationSchema = z.discriminatedUnion("$", [
  z.object({ $: z.literal("Host") }),
  z.object({ $: z.literal("Applied"), profile: profileSchema }),
]);
const transitionSchema = z.discriminatedUnion("$", [
  z.object({ $: z.literal("TrRejected") }),
  z.object({ $: z.literal("TrAccepted"), next: stateSchema }),
]);
const callable = z.custom<(...arguments_: unknown[]) => unknown>(
  (value) => typeof value === "function",
);
const model = z
  .object({
    step: callable,
    decide: callable,
    status: callable,
    published: callable,
    session_step: callable,
    is_applied: callable,
    needs_reload: callable,
    should_load: callable,
    session_status: callable,
  })
  .parse(artifact);

export type RootState = z.infer<typeof stateSchema>;
export type Application = z.infer<typeof applicationSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type RootEvent =
  | {
      $:
        | "EvSessionOpen"
        | "EvTrustObserved"
        | "EvAllowRequested"
        | "EvRevoke"
        | "EvCommand"
        | "EvLoadFail"
        | "EvCooldownElapsed"
        | "EvProjectChanged";
    }
  | { $: "EvLoadOk"; profile: z.infer<typeof profileSchema> };
export type SessionEvent =
  | { $: "EvBudgetElapsed" | "EvPrepared" | "EvChanged" | "EvRevoked" }
  | { $: "EvOpened"; decision: Decision };

export function advance(state: RootState, event: RootEvent): RootState {
  const transition = transitionSchema.parse(model.step(state, event));
  return transition.$ === "TrAccepted" ? transition.next : state;
}
export function rootState(
  trusted: boolean,
  phase: "detected" | "loading" | "ready" | "error",
  root: string,
): RootState {
  let state: RootState = { $: "Untrusted" };
  if (trusted) {
    state = advance(state, { $: "EvTrustObserved" });
    if (phase !== "detected") state = advance(state, { $: "EvSessionOpen" });
    if (phase === "ready")
      state = advance(state, {
        $: "EvLoadOk",
        profile: { $: "Profile", path: root },
      });
    if (phase === "error") state = advance(state, { $: "EvLoadFail" });
  }
  return state;
}
export function decide(state: RootState): Decision {
  return decisionSchema.parse(model.decide(state, { $: "EvSessionOpen" }));
}
export function status(state: RootState) {
  return z
    .enum(["denied", "detected", "loading", "ready", "error"])
    .parse(model.published(model.status(state)));
}
export function sessionStatus(state: RootState, application: Application) {
  return z
    .enum(["denied", "detected", "loading", "ready", "error"])
    .parse(model.session_status(state, application));
}
export function shouldLoad(state: RootState, event: RootEvent): boolean {
  return z.boolean().parse(model.should_load(state, event));
}
export function sessionStep(
  application: Application,
  event: SessionEvent,
): Application {
  return applicationSchema.parse(model.session_step(application, event));
}
export function isApplied(application: Application): boolean {
  return z.boolean().parse(model.is_applied(application));
}
export function needsReload(
  state: RootState,
  application: Application,
  fresh: boolean,
): boolean {
  return z.boolean().parse(model.needs_reload(state, application, fresh));
}
