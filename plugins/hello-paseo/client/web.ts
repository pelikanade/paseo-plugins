import { Linking, Platform } from "react-native";

declare const window: {
  open(url: string, target: string, features: string): unknown;
};

export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}
