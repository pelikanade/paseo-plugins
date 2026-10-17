import type { PluginTheme } from "@getpaseo/plugin";

export type Tone = "normal" | "warning" | "danger";

const WARNING_PCT = 70;
const DANGER_PCT = 90;
const WARNING_LOAD = 0.7;
const DANGER_LOAD = 1;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export const cpuTone = (usagePct: number): Tone => {
  if (usagePct >= DANGER_PCT) return "danger";
  if (usagePct >= WARNING_PCT) return "warning";
  return "normal";
};

export const memoryTone = (usagePct: number): Tone => {
  if (usagePct >= DANGER_PCT) return "danger";
  if (usagePct >= WARNING_PCT) return "warning";
  return "normal";
};

export const loadTone = (load: number, cores: number): Tone => {
  const perCore = load / Math.max(cores, 1);
  if (perCore >= DANGER_LOAD) return "danger";
  if (perCore >= WARNING_LOAD) return "warning";
  return "normal";
};

export const toneColor = (theme: PluginTheme, tone: Tone): string => {
  switch (tone) {
    case "normal":
      return theme.colors.foreground;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
  }
};

export const toneFill = (theme: PluginTheme, tone: Tone): string => {
  switch (tone) {
    case "normal":
      return theme.colors.accent;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
  }
};

export const formatPercent = (value: number): string =>
  `${String(Math.round(Math.min(100, Math.max(0, value))))}%`;

export const formatLoad = (value: number): string => value.toFixed(2);

export const formatBytes = (bytes: number): string => {
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(1)} GiB`;
  return `${(bytes / MIB).toFixed(0)} MiB`;
};

export const formatUptime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${String(days)}d ${String(hours)}h`;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  return `${String(minutes)}m`;
};

export const loadPercent = (load: number, cores: number): number =>
  Math.min(100, Math.max(0, (load / Math.max(cores, 1)) * 100));
