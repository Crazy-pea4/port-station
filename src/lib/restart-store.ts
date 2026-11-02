import { randomUUID } from "node:crypto";
import type { RestartRecipe } from "./restart-recipe";

interface RestartRecord {
  port: number;
  recipe: RestartRecipe;
  createdAt: number;
  busy: boolean;
}

const state = globalThis as typeof globalThis & {
  portStationRestarts?: Map<string, RestartRecord>;
  portStationStarting?: Set<number>;
};
const records = (state.portStationRestarts ??= new Map());
const starting = (state.portStationStarting ??= new Set());
const TTL_MS = 24 * 60 * 60_000;

export function saveRestart(port: number, recipe: RestartRecipe): string {
  for (const [id, record] of records) {
    if (!record.busy && Date.now() - record.createdAt > TTL_MS) records.delete(id);
  }
  if (records.size >= 128) {
    const oldestIdle = [...records].find(([, record]) => !record.busy);
    const oldest = oldestIdle ?? records.entries().next().value;
    if (oldest) records.delete(oldest[0]);
  }
  const id = randomUUID();
  records.set(id, { port, recipe, createdAt: Date.now(), busy: false });
  return id;
}

export function getRestart(id: string): RestartRecord | undefined {
  const record = records.get(id);
  if (!record || Date.now() - record.createdAt > TTL_MS) return;
  return record;
}

export function claimRestart(record: RestartRecord): (() => void) | undefined {
  if (record.busy || starting.has(record.port)) return;
  record.busy = true;
  starting.add(record.port);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    record.busy = false;
    starting.delete(record.port);
  };
}
