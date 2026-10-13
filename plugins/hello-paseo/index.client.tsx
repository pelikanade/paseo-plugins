import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GreetingScreen } from "./client/greeting";
import { GreetingSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "greeting",
    title: "Greeting",
    Component: GreetingScreen,
  });
  client.addSidebarHeaderItem({
    id: "greeting",
    title: "Greeting",
    Component: GreetingSidebarItem,
  });
  return () => {};
}
