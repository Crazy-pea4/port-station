import os from "node:os";
import { execFile } from "node:child_process";

export interface Listener {
  port: number;
  pid?: number;
  process?: string;
  login?: string;
}

/** macOS 系统自带、常以当前用户身份监听端口、但与开发无关的进程 */
const SYSTEM_BLOCKLIST = new Set([
  "rapportd", // AirPlay 接收器 (端口 7000)
  "sharingd",
  "identityservicesd",
  "imagent",
  "cloudd",
  "bird",
  "controlcenter",
  "airportd",
  "bluetoothd",
  "hidd",
  "corespeechd",
  "assistantd",
  "syncdefaultsd",
  "familycircled",
]);

export function isUserLogin(login: string | undefined): boolean {
  if (!login) return false;
  try {
    return login === os.userInfo().username;
  } catch {
    return false;
  }
}

export function isSystemProcess(name: string | undefined): boolean {
  if (!name) return false;
  return SYSTEM_BLOCKLIST.has(name.toLowerCase());
}

/** 扫描当前所有 TCP LISTEN 监听,返回端口/进程/属主信息 */
export function scanListeners(): Promise<Listener[]> {
  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcnL"],
      { timeout: 4000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve([]);
          return;
        }
        interface Rec {
          pid?: number;
          process?: string;
          login?: string;
          ports: Set<number>;
        }
        const byKey = new Map<string, Rec>();
        let cur: Rec | null = null;
        for (const line of (stdout ?? "").split("\n")) {
          if (!line) continue;
          const tag = line[0];
          const val = line.slice(1);
          if (tag === "p") {
            cur = { pid: Number(val) || undefined, ports: new Set() };
            byKey.set(val, cur);
          } else if (!cur) {
            continue;
          } else if (tag === "c") {
            cur.process = val;
          } else if (tag === "L") {
            cur.login = val;
          } else if (tag === "n") {
            const m = val.match(/:(\d+)$/);
            if (m) cur.ports.add(Number(m[1]));
          }
        }
        const listeners: Listener[] = [];
        for (const rec of byKey.values()) {
          for (const port of rec.ports) {
            listeners.push({ port, pid: rec.pid, process: rec.process, login: rec.login });
          }
        }
        resolve(listeners);
      },
    );
  });
}
