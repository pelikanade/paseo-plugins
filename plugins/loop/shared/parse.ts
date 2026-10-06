export const MAX_INTERVAL_SECONDS = 7 * 24 * 60 * 60;

const UNITS: Readonly<Record<string, number>> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
};

const unitPattern = Object.keys(UNITS)
  .sort((left, right) => right.length - left.length)
  .join("|");
const leading = new RegExp(
  `^(\\d{1,7})\\s*(${unitPattern})\\b\\s+(\\S[\\s\\S]*)$`,
  "i",
);
const trailing = new RegExp(
  `^([\\s\\S]+?)\\s+every\\s+(\\d{1,7})\\s*(${unitPattern})\\s*$`,
  "i",
);
const bare = new RegExp(
  `^(?:every\\s+)?(\\d{1,7})\\s*(${unitPattern})\\s*$`,
  "i",
);

export const usageText = [
  "Usage: /loop [interval] <prompt>",
  "Examples: /loop 5m check deploy · /loop check deploy every 5 minutes · /loop work until tests pass · /loop stop",
  "Intervals: 30s, 5m, 2h, 1d, or unit words. No interval lets the agent choose a heartbeat or a watcher.",
].join("\n");

export type LoopParse =
  | { type: "usage" }
  | { type: "stop" }
  | { type: "invalid"; message: string }
  | {
      type: "fixed";
      everySeconds: number;
      prompt: string;
      purpose: string;
    }
  | { type: "dynamic"; prompt: string; purpose: string };

export function purposeFrom(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "task";
}

function intervalSeconds(
  count: string,
  unit: string,
): { ok: true; seconds: number } | { ok: false; message: string } {
  const key = unit.toLowerCase();
  if (!Object.hasOwn(UNITS, key))
    return { ok: false, message: `Unknown interval unit "${unit}"` };
  const factor = UNITS[key];
  const amount = Number(count);
  if (!Number.isInteger(amount))
    return { ok: false, message: "Interval must be a whole number" };
  const seconds = amount * factor;
  if (!Number.isSafeInteger(seconds) || seconds < 1)
    return { ok: false, message: "Interval must be at least 1 second" };
  if (seconds > MAX_INTERVAL_SECONDS)
    return { ok: false, message: "Interval must be at most 7 days" };
  return { ok: true, seconds };
}

function fixed(count: string, unit: string, prompt: string): LoopParse {
  if (prompt.length === 0)
    return {
      type: "invalid",
      message: `A loop needs a prompt after the interval. ${usageText}`,
    };
  if (prompt.length > 4000)
    return {
      type: "invalid",
      message: "Prompt must be at most 4000 characters",
    };
  const interval = intervalSeconds(count, unit);
  if (!interval.ok) return { type: "invalid", message: interval.message };
  return {
    type: "fixed",
    everySeconds: interval.seconds,
    prompt,
    purpose: purposeFrom(prompt),
  };
}

export function parseLoop(text: string): LoopParse {
  const input = text.trim();
  if (input.length === 0) return { type: "usage" };
  if (input.toLowerCase() === "stop") return { type: "stop" };
  if (bare.test(input))
    return {
      type: "invalid",
      message: `A loop needs a prompt after the interval. ${usageText}`,
    };
  const lead = leading.exec(input);
  if (lead) return fixed(lead[1], lead[2], lead[3].trim());
  const trail = trailing.exec(input);
  if (trail) return fixed(trail[2], trail[3], trail[1].trim());
  if (input.length > 4000)
    return {
      type: "invalid",
      message: "Prompt must be at most 4000 characters",
    };
  return { type: "dynamic", prompt: input, purpose: purposeFrom(input) };
}
