import type { ServiceInfo } from "./types";

const state = globalThis as typeof globalThis & {
  portStationSeen?: Map<number, { service: ServiceInfo; at: number }>;
};
const seen = (state.portStationSeen ??= new Map());
const TTL_MS = 120_000;

export function updateSnapshot(services: ServiceInfo[]) {
  const now = Date.now();
  for (const s of services) seen.set(s.port, { service: s, at: now });
  for (const [port, v] of seen) {
    if (now - v.at > TTL_MS) seen.delete(port);
  }
}

/** 查询端口对应的服务(含最近 2 分钟内消失的,供已关闭卡片显示图标) */
export function getSeenService(port: number): ServiceInfo | undefined {
  const entry = seen.get(port);
  if (!entry || Date.now() - entry.at > TTL_MS) {
    seen.delete(port);
    return;
  }
  return entry.service;
}
