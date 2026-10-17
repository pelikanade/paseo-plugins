import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { sampleRpc } from "../shared/sample";

export function useHostSample(hostId: string) {
  const read = useRpc(sampleRpc);
  return useQuery({
    queryKey: ["host-monitor", hostId],
    queryFn: () => read({}),
    refetchInterval: 2000,
    staleTime: 0,
    retry: 1,
  });
}
