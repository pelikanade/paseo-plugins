import type { PluginServerContext } from "@getpaseo/plugin/server";
import { HostSampler } from "./server/sampler";
import { sampleRpc } from "./shared/sample";

export default function contribute(server: PluginServerContext) {
  const sampler = new HostSampler();
  sampler.start();
  server.handle(sampleRpc, () => sampler.read());
  return () => {
    sampler.stop();
  };
}
