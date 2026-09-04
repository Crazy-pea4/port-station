import type { ServiceInfo } from "./types";

/** 最近一次扫描的服务快照,供图标接口等使用 */
let snapshot: ServiceInfo[] = [];
const seen = new Map<number, { service: ServiceInfo; at: number }>();
const TTL_MS = 120_000;

export function updateSnapshot(services: ServiceInfo[]) {
  snapshot = services;
  const now = Date.now();
  for (const s of services) seen.set(s.port, { service: s, at: now });
  for (const [port, v] of seen) {
    if (now - v.at > TTL_MS) seen.delete(port);
  }
}

/** 查询端口对应的服务(含最近 2 分钟内消失的,供已关闭卡片显示图标) */
export function getSeenService(port: number): ServiceInfo | undefined {
  return seen.get(port)?.service;
}
