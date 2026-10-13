import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

export function GreetingSidebarItem(props: PluginSidebarItemProps) {
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
