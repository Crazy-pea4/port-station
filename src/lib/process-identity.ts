import { execFile } from "node:child_process";
import type { ProcessIdentity } from "./types";

export function sameProcess(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.uid === b.uid && a.startedAt === b.startedAt;
}

/** 不把读取失败当成“进程已退出”,避免误报关闭成功。 */
export async function readProcessIdentities(pids: number[]): Promise<Map<number, ProcessIdentity>> {
  const unique = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 1);
  const result = new Map<number, ProcessIdentity>();
  if (!unique.length) return result;
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-o", "pid=,uid=,lstart=,stat=", "-p", unique.join(",")],
      { timeout: 2000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
      (error, out) => {
        if (error && error.code !== 1) reject(new Error("无法核对进程身份，请刷新后重试"));
        else resolve(out ?? "");
      });
  });
  const zombies = new Set<number>();
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(\S+)/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (m[4].includes("Z")) zombies.add(pid);
    else result.set(pid, { pid, uid: Number(m[2]), startedAt: m[3].replace(/\s+/g, " ") });
  }
  for (const pid of unique) {
    if (result.has(pid) || zombies.has(pid)) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") continue;
      throw new Error("无法核对进程身份，请刷新后重试");
    }
    throw new Error("无法核对进程身份，请刷新后重试");
  }
  return result;
}

/** 每次发信号前重新核对身份;绝不按端口选择新的强杀目标。 */
export async function signalOriginal(target: ProcessIdentity, signal: NodeJS.Signals): Promise<boolean> {
  const current = (await readProcessIdentities([target.pid])).get(target.pid);
  if (!current || !sameProcess(target, current)) return false;
  if (target.pid === process.pid || target.uid !== process.getuid?.()) {
    throw new Error("不允许关闭该进程");
  }
  try {
    process.kill(target.pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw new Error("无法结束进程，请检查权限");
  }
}
