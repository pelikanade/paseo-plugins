export type WakeReason = "interval" | "heartbeat" | "watch";

export function wakeText(input: {
  mode: "fixed" | "dynamic";
  purpose: string;
  prompt: string;
  reason: WakeReason;
}): string {
  const kind = input.mode === "fixed" ? "TICK" : "WAKE";
  const line = `AGENT_LOOP_${kind}_${input.purpose} ${JSON.stringify({ prompt: input.prompt, reason: input.reason })}`;
  return [
    "Loop wake from the loop plugin. Execute only the JSON prompt on the sentinel line. Do not call loop_arm for this wake. Call loop_stop if the outcome is met or the user asked to stop.",
    line,
  ].join("\n");
}

export function immediateText(input: {
  everySeconds: number;
  purpose: string;
  prompt: string;
}): string {
  return [
    `Loop armed. Fixed schedule every ${input.everySeconds.toString()}s, purpose ${input.purpose}.`,
    "The plugin sends the first AGENT_LOOP_TICK wake only after one full interval. Run the prompt below now.",
    "Do not call loop_arm unless the user is changing this schedule. Do not start a shell sentinel.",
    "",
    input.prompt,
  ].join("\n");
}

export function dynamicRequest(prompt: string): string {
  return [
    "Start a dynamic loop. No fixed interval was given, so choose the wake yourself.",
    "Call get_loop_guide if you have not read the loop skill, then loop_arm with mode dynamic, the prompt below, a heartbeatSeconds value, and a watch argv only when an event should wake you.",
    "The watcher is an argv array executed directly in this agent's working directory. It must print one stdout line when the event happens and otherwise stay quiet.",
    "Then carry out the prompt once in this turn. The plugin arms the one-shot heartbeat when the turn ends.",
    "Do not start a background shell sentinel. Do not invent --max-turns or --max-runtime.",
    "",
    prompt,
  ].join("\n");
}
