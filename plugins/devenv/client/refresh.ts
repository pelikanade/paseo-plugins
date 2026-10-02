const listeners = new Set<(agentId: string) => void>();

export function observeRefresh(listener: (agentId: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function refreshStatus(agentId: string) {
  for (const listener of listeners) listener(agentId);
}
