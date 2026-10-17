import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { readImageRpc } from "../shared/contracts";
import type { ReadImageItem } from "../shared/protocol";

export function ReadImageRow({
  agentId,
  item,
  theme,
  layout,
  host,
}: PluginTimelineItemProps<ReadImageItem>) {
  const readImage = useRpc(readImageRpc);
  const query = useQuery({
    queryKey: [
      "paseo-omp-optimize",
      "read-image",
      host.id,
      agentId,
      item.data.filePath,
    ],
    queryFn: () => readImage({ agentId, filePath: item.data.filePath }),
    retry: false,
    staleTime: Infinity,
  });
  const styles = useMemo(
    () =>
      StyleSheet.create({
        root: {
          gap: 6,
          paddingVertical: layout.compact ? 6 : 10,
        },
        path: {
          color: theme.colors.foregroundMuted,
          fontSize: 12,
        },
        status: {
          alignItems: "center",
          flexDirection: "row",
          gap: 8,
        },
        statusText: {
          color: theme.colors.foregroundMuted,
          fontSize: 12,
        },
        text: {
          color: theme.colors.foreground,
          fontSize: 12,
        },
        error: {
          color: theme.colors.statusDanger,
          fontSize: 12,
        },
        image: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderRadius: 6,
          borderWidth: StyleSheet.hairlineWidth,
        },
      }),
    [theme, layout.compact],
  );
  const dimensions = useMemo(() => {
    const maxWidth = layout.compact ? 280 : 560;
    const maxHeight = layout.compact ? 320 : 480;
    const naturalWidth = item.data.width ?? maxWidth;
    const naturalHeight = item.data.height ?? Math.round((maxWidth * 9) / 16);
    const scale = Math.min(
      1,
      maxWidth / naturalWidth,
      maxHeight / naturalHeight,
    );
    return {
      width: Math.max(1, Math.round(naturalWidth * scale)),
      height: Math.max(1, Math.round(naturalHeight * scale)),
    };
  }, [item.data.width, item.data.height, layout.compact]);
  const dataUri = query.data
    ? `data:${query.data.mimeType};base64,${query.data.base64}`
    : null;
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const decodeFailed = dataUri !== null && failedUri === dataUri;
  const failure =
    query.error?.message ??
    (decodeFailed ? "This client cannot display this image." : null);
  return (
    <View style={styles.root} testID="paseo-omp-read-image">
      <Text numberOfLines={1} style={styles.path}>
        {item.data.filePath}
      </Text>
      {query.isPending ? (
        <View style={styles.status}>
          <ActivityIndicator
            color={theme.colors.foregroundMuted}
            size="small"
          />
          <Text style={styles.statusText}>Loading image</Text>
        </View>
      ) : null}
      {dataUri && !decodeFailed ? (
        <View
          accessible
          accessibilityLabel={`Image read from ${item.data.filePath}`}
          accessibilityRole="image"
        >
          <Image
            onError={() => {
              setFailedUri(dataUri);
            }}
            resizeMode="contain"
            source={{ uri: dataUri }}
            style={[styles.image, dimensions]}
          />
        </View>
      ) : null}
      {failure ? (
        <>
          <Text selectable style={styles.text}>
            {item.data.content}
          </Text>
          <Text accessibilityRole="alert" style={styles.error}>
            {failure}
          </Text>
        </>
      ) : null}
    </View>
  );
}
