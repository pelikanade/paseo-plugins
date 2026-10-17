import type { PluginClientContext } from "@getpaseo/plugin/client";
import { HostMonitorFooter } from "./client/footer";

export default function contribute(client: PluginClientContext) {
  return client.addSidebarFooterItem({
    id: "host-monitor",
    title: "Host",
    Component: HostMonitorFooter,
  });
}
