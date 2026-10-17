import type { PluginPopoverProps } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { Pressable, Text, View } from "react-native";
import {
  cpuTone,
  formatBytes,
  formatLoad,
  formatPercent,
  formatUptime,
  loadPercent,
  loadTone,
  memoryTone,
  toneColor,
  toneFill,
  type Tone,
} from "./format";
import { Sparkline } from "./sparkline";
import { useHostSample } from "./use-sample";

function MetricBlock({
  theme,
  label,
  value,
  detail,
  percent,
  tone,
  values,
}: {
  theme: PluginPopoverProps["theme"];
  label: string;
  value: string;
  detail: string;
  percent: number;
  tone: Tone;
  values: readonly number[];
}) {
  const clampedPercent = Math.min(100, Math.max(0, percent));
  return (
    <View style={{ gap: 4 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 12,
            fontWeight: "500",
          }}
        >
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: toneColor(theme, tone),
            fontSize: 18,
            lineHeight: 22,
            fontWeight: "600",
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      </View>
      <View
        style={{
          height: 4,
          flexDirection: "row",
          borderRadius: 2,
          backgroundColor: theme.colors.surface2,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flex: clampedPercent,
            backgroundColor: toneFill(theme, tone),
          }}
        />
        <View style={{ flex: 100 - clampedPercent }} />
      </View>
      <Sparkline
        values={values}
        color={toneFill(theme, tone)}
        background={theme.colors.surface2}
      />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            flex: 1,
            color: theme.colors.foregroundMuted,
            fontSize: 11,
            lineHeight: 15,
          }}
        >
          {detail}
        </Text>
        <Text
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 11,
            lineHeight: 15,
          }}
        >
          60s
        </Text>
      </View>
    </View>
  );
}

export function HostMonitorPopover(props: PluginPopoverProps) {
  const { theme, layout, host } = props;
  const query = useHostSample(host.id);
  const sample = query.data;
  const error = query.error?.message;
  const cores = sample?.host.cores ?? 1;
  const body = {
    color: theme.colors.foreground,
    fontSize: 12,
    lineHeight: 17,
  };
  return (
    <ScrollView
      style={{ flexShrink: 1, minWidth: 0 }}
      contentContainerStyle={{
        padding: layout.compact ? 14 : 16,
        gap: 12,
        width: "100%",
        maxWidth: 380,
        alignSelf: "flex-start",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            accessibilityRole="header"
            style={{
              color: theme.colors.foreground,
              fontSize: 15,
              lineHeight: 20,
              fontWeight: "600",
            }}
          >
            Host monitor
          </Text>
          <Text
            numberOfLines={1}
            style={{ ...body, color: theme.colors.foregroundMuted }}
          >
            {sample?.host.hostname ?? host.label}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close host monitor"
          hitSlop={8}
          onPress={() => {
            props.close();
          }}
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            backgroundColor: pressed ? theme.colors.surface1 : "transparent",
          })}
        >
          <Icon name="X" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>

      {sample === undefined ? (
        <Text style={{ ...body, color: theme.colors.foregroundMuted }}>
          {error ?? "Reading host metrics..."}
        </Text>
      ) : (
        <>
          <View style={{ gap: 2 }}>
            <Text style={{ ...body, color: theme.colors.foregroundMuted }}>
              {`${sample.host.platform} ${sample.host.arch} · ${String(sample.host.cores)} cores · up ${formatUptime(sample.host.uptimeSeconds)}`}
            </Text>
            <Text style={{ ...body, color: theme.colors.foregroundMuted }}>
              {`Kernel ${sample.host.release}`}
            </Text>
          </View>

          <MetricBlock
            theme={theme}
            label="CPU"
            value={formatPercent(sample.cpu.usagePct)}
            detail={`${String(sample.host.cores)} logical cores`}
            percent={sample.cpu.usagePct}
            tone={cpuTone(sample.cpu.usagePct)}
            values={sample.history.cpu}
          />
          <MetricBlock
            theme={theme}
            label="Memory"
            value={formatPercent(sample.memory.usagePct)}
            detail={`${formatBytes(sample.memory.usedBytes)} of ${formatBytes(sample.memory.totalBytes)} used`}
            percent={sample.memory.usagePct}
            tone={memoryTone(sample.memory.usagePct)}
            values={sample.history.memory}
          />
          <MetricBlock
            theme={theme}
            label="Load average"
            value={
              sample.load.supported
                ? [
                    formatLoad(sample.load.one),
                    formatLoad(sample.load.five),
                    formatLoad(sample.load.fifteen),
                  ].join(" / ")
                : "—"
            }
            detail={
              sample.load.supported
                ? `1m / 5m / 15m · ${String(cores)} cores`
                : "Not reported on Windows"
            }
            percent={loadPercent(sample.load.one, cores)}
            tone={loadTone(sample.load.one, cores)}
            values={sample.history.load.map((value) =>
              loadPercent(value, cores),
            )}
          />

          {error ? (
            <Text style={{ ...body, color: theme.colors.statusDanger }}>
              {error}
            </Text>
          ) : null}

          <Text style={{ ...body, color: theme.colors.foregroundMuted }}>
            {`Updated ${new Date(sample.sampledAt).toLocaleTimeString()} · refreshes every 2s`}
          </Text>
        </>
      )}
    </ScrollView>
  );
}
