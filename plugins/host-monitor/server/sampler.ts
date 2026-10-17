import { readFileSync } from "node:fs";
import {
  arch,
  cpus,
  freemem,
  hostname,
  loadavg,
  platform,
  release,
  totalmem,
  uptime,
} from "node:os";
import type { HostSample } from "../shared/sample";

const SAMPLE_INTERVAL_MS = 1000;
const HISTORY_LENGTH = 60;
const KIB = 1024;
const PERCENT = 100;
const PRECISION = 100;

interface CoreTimes {
  idle: number;
  total: number;
}

interface Snapshot {
  sampledAt: number;
  cores: number;
  cpuPct: number;
  perCorePct: number[];
  memory: HostSample["memory"];
  load: HostSample["load"];
}

interface CpuUsage {
  usagePct: number;
  perCorePct: number[];
}

const readCpuTimes = (): CoreTimes[] =>
  cpus().map((core) => ({
    idle: core.times.idle,
    total:
      core.times.user +
      core.times.nice +
      core.times.sys +
      core.times.idle +
      core.times.irq,
  }));

const computeCpuUsage = (
  previous: readonly CoreTimes[],
  current: readonly CoreTimes[],
): CpuUsage => {
  const comparable = previous.length === current.length;
  const perCorePct = current.map((core, index) => {
    const before = comparable ? previous[index] : { idle: 0, total: 0 };
    const idle = core.idle - before.idle;
    const total = core.total - before.total;
    if (total <= 0) return 0;
    return Math.min(PERCENT, Math.max(0, (1 - idle / total) * PERCENT));
  });
  const idle = current.reduce((total, core) => total + core.idle, 0);
  const total = current.reduce((total, core) => total + core.total, 0);
  const previousIdle = previous.reduce((total, core) => total + core.idle, 0);
  const previousTotal = previous.reduce((total, core) => total + core.total, 0);
  const elapsedIdle = idle - (comparable ? previousIdle : 0);
  const elapsedTotal = total - (comparable ? previousTotal : 0);
  return {
    perCorePct,
    usagePct:
      elapsedTotal > 0
        ? Math.min(
            PERCENT,
            Math.max(0, (1 - elapsedIdle / elapsedTotal) * PERCENT),
          )
        : 0,
  };
};

const linuxAvailableBytes = (): number | undefined => {
  if (platform() !== "linux") return undefined;
  try {
    const report = readFileSync("/proc/meminfo", "utf8");
    const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(report);
    if (match === null) return undefined;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value * KIB : undefined;
  } catch {
    return undefined;
  }
};

const readMemory = (): HostSample["memory"] => {
  const totalBytes = totalmem();
  const available = linuxAvailableBytes() ?? freemem();
  const availableBytes = Math.min(totalBytes, Math.max(0, available));
  const usedBytes = totalBytes - availableBytes;
  return {
    totalBytes,
    usedBytes,
    availableBytes,
    usagePct:
      totalBytes > 0
        ? Math.min(PERCENT, Math.max(0, (usedBytes / totalBytes) * PERCENT))
        : 0,
  };
};

const readLoad = (): HostSample["load"] => {
  const [one = 0, five = 0, fifteen = 0] = loadavg();
  return {
    one,
    five,
    fifteen,
    supported: platform() !== "win32",
  };
};

export class HostSampler {
  private previous: CoreTimes[] = [];
  private samples: Snapshot[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor() {
    this.capture();
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      this.capture();
    }, SAMPLE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  read(): HostSample {
    const latest = this.samples.at(-1);
    return this.view(latest ?? this.capture());
  }

  private capture(): Snapshot {
    const current = readCpuTimes();
    const usage = computeCpuUsage(this.previous, current);
    this.previous = current;
    const snapshot: Snapshot = {
      sampledAt: Date.now(),
      cores: Math.max(current.length, 1),
      cpuPct: Math.round(usage.usagePct * PRECISION) / PRECISION,
      perCorePct: usage.perCorePct.map(
        (value) => Math.round(value * PRECISION) / PRECISION,
      ),
      memory: readMemory(),
      load: readLoad(),
    };
    this.samples.push(snapshot);
    if (this.samples.length > HISTORY_LENGTH) this.samples.shift();
    return snapshot;
  }

  private view(latest: Snapshot): HostSample {
    return {
      sampledAt: latest.sampledAt,
      host: {
        hostname: hostname(),
        platform: platform(),
        arch: arch(),
        release: release(),
        cores: latest.cores,
        uptimeSeconds: uptime(),
      },
      cpu: {
        usagePct: latest.cpuPct,
        perCorePct: [...latest.perCorePct],
      },
      memory: { ...latest.memory },
      load: { ...latest.load },
      history: {
        sampledAt: this.samples.map((sample) => sample.sampledAt),
        cpu: this.samples.map((sample) => sample.cpuPct),
        memory: this.samples.map((sample) => sample.memory.usagePct),
        load: this.samples.map((sample) => sample.load.one),
      },
    };
  }
}
