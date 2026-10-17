import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import {
  cpuTone,
  formatLoad,
  formatPercent,
  loadTone,
  memoryTone,
  toneColor,
} from "./format";
import { HostMonitorPopover } from "./popover";
import { useHostSample } from "./use-sample";

function Metric({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: string;
  color: string;
  muted: string;
}) {
  return (
    <View style={{ alignItems: "flex-end", gap: 1 }}>
      <Text
        style={{
          color: muted,
          fontSize: 9,
          lineHeight: 11,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color,
          fontSize: 11,
          lineHeight: 14,
          fontWeight: "600",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export function HostMonitorFooter(props: PluginSidebarItemProps) {
  const { theme, layout, host } = props;
  const query = useHostSample(host.id);
  const sample = query.data;
  const cpu = cpuTone(sample?.cpu.usagePct ?? 0);
  const memory = memoryTone(sample?.memory.usagePct ?? 0);
  const load = loadTone(sample?.load.one ?? 0, sample?.host.cores ?? 1);
  const cpuText =
    sample === undefined ? "—" : formatPercent(sample.cpu.usagePct);
  const memoryText =
    sample === undefined ? "—" : formatPercent(sample.memory.usagePct);
  const loadText =
    sample === undefined || !sample.load.supported
      ? "—"
      : formatLoad(sample.load.one);
  const label = `Host monitor: CPU ${cpuText}, memory ${memoryText}, load ${loadText}`;
  const open = () => {
    props.openPopover(HostMonitorPopover);
  };
  return (
    <SidebarRow
      icon="Activity"
      label="Host"
      onPress={open}
      trailing={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint="Open host details"
          hitSlop={8}
          onPress={open}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: layout.compact ? 6 : 10,
            }}
          >
            <Metric
              label="CPU"
              value={cpuText}
              color={toneColor(theme, cpu)}
              muted={theme.colors.foregroundMuted}
            />
            <Metric
              label="MEM"
              value={memoryText}
              color={toneColor(theme, memory)}
              muted={theme.colors.foregroundMuted}
            />
            <Metric
              label="LOAD"
              value={loadText}
              color={toneColor(theme, load)}
              muted={theme.colors.foregroundMuted}
            />
          </View>
        </Pressable>
      }
    />
  );
}
