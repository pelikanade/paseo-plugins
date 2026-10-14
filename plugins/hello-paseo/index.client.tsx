import type {
  PluginClientContext,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { GreetingScreen } from "./client/greeting";

function GreetingItem(props: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="MessageCircle"
      active={props.currentScreen?.screenId === "greeting"}
      onPress={() => {
        props.openScreen({ screenId: "greeting" });
      }}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "greeting",
    title: "Greeting",
    Component: GreetingScreen,
  });
  client.addSidebarHeaderItem({
    id: "greeting",
    title: "Greeting",
    Component: GreetingItem,
  });
  return () => {};
}
