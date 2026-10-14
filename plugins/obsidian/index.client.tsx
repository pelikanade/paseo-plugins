import type { PluginClientContext } from "@getpaseo/plugin/client";
import { attachmentSource } from "./client/attachment";
import { SettingsScreen } from "./client/settings";
import { copy } from "./client/status";
import { createVaultScreen } from "./client/vault-screen";
import { VaultSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addScreen({
      id: "vault",
      title: copy.title,
      Component: createVaultScreen(() => {
        client.openSettings("obsidian");
      }),
    }),
    client.addSidebarHeaderItem({
      id: "vault",
      title: copy.title,
      Component: VaultSidebarItem,
    }),
    client.addSettingsScreen({
      id: "obsidian",
      title: copy.title,
      icon: "Settings",
      Component: SettingsScreen,
    }),
    client.addAttachmentSource(attachmentSource),
  ];
  return async () => {
    for (const cleanup of cleanups) await cleanup();
  };
}
