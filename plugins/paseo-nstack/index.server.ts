import type { PluginServerContext } from "@getpaseo/plugin/server";
import { installWatcher } from "./server/install";

export default function contribute(server: PluginServerContext) {
  return installWatcher(server, {
    github: {
      hostname: process.env.PASEO_NSTACK_GITHUB_HOST ?? "github.com",
      restBaseUrl:
        process.env.PASEO_NSTACK_GITHUB_REST_URL ?? "https://api.github.com",
      graphqlUrl:
        process.env.PASEO_NSTACK_GITHUB_GRAPHQL_URL ??
        "https://api.github.com/graphql",
    },
  });
}
