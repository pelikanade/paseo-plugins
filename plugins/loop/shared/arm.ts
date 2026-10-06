export function armError(input: {
  mode: "fixed" | "dynamic";
  everySeconds?: number;
  heartbeatSeconds?: number;
  watch?: readonly string[];
}): string | null {
  switch (input.mode) {
    case "fixed":
      if (input.everySeconds === undefined)
        return "Fixed loops need everySeconds";
      if (input.heartbeatSeconds !== undefined)
        return "Fixed loops do not take heartbeatSeconds";
      if (input.watch !== undefined) return "Fixed loops do not take a watcher";
      return null;
    case "dynamic":
      if (input.heartbeatSeconds === undefined)
        return "Dynamic loops need heartbeatSeconds";
      if (input.everySeconds !== undefined)
        return "Dynamic loops do not take everySeconds";
      return null;
    default: {
      const unreachable: never = input.mode;
      return unreachable;
    }
  }
}
