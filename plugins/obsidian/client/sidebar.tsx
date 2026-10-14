import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

export function VaultSidebarItem(props: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Notebook"
      active={props.currentScreen?.screenId === "vault"}
      onPress={() => {
        props.openScreen({ screenId: "vault" });
      }}
    />
  );
}
