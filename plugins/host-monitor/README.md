# Host monitor

A Paseo plugin that shows the Paseo daemon host's CPU, memory and load average in the bottom of the sidebar.

## What it shows

The footer row is a compact live summary:

- CPU usage across all logical cores
- Memory usage from `MemAvailable` on Linux and `os.freemem()` elsewhere
- One-minute load average

Select the row to open a popover with:

- CPU usage, logical core count and a 60 second sparkline
- Memory used and total, percentage and a 60 second sparkline
- One, five and fifteen minute load averages and a 60 second sparkline
- Hostname, platform, architecture, kernel release and uptime

The daemon samples once per second and retains 60 samples in memory. The client refreshes every two seconds. No history is persisted, and no metrics leave the daemon.

## Thresholds

| Metric        | Warning | Critical |
| ------------- | ------- | -------- |
| CPU usage     | 70%     | 90%      |
| Memory usage  | 70%     | 90%      |
| Load per core | 0.7     | 1.0      |

Load averages are reported as raw one, five and fifteen minute values. Their color uses the one-minute value divided by the logical core count. Windows reports no load averages, so the plugin shows dashes there.

## Install into a daemon

```sh
pnpm exec paseo plugin install "$PWD/plugins/host-monitor"
pnpm exec paseo plugin reload host-monitor
```

The daemon must run Paseo 0.11.2 or newer. The plugin has no runtime dependencies beyond the host SDK and Node built-ins.

## Development

```sh
pnpm --filter @paseo-plugins/host-monitor typecheck
pnpm exec paseo plugin reload host-monitor
pnpm test:e2e
```
