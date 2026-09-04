import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RestartRecipe } from "./types";

function exec(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? "" : (stdout ?? ""));
    });
  });
}

/** 读取项目名:cwd 下的 package.json 的 name 字段 */
export function packageProjectName(cwd: string | undefined): string | undefined {
  if (!cwd || !cwd.startsWith("/")) return undefined;
  try {
    const raw = readFileSync(path.join(cwd, "package.json"), "utf8");
    const name = (JSON.parse(raw) as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) {
      return name.trim().slice(0, 60);
    }
  } catch {
    // 没有 package.json 或解析失败
  }
  return undefined;
}

/** 读取 .app 的显示名:CFBundleDisplayName → CFBundleName → 目录名 */
export async function appDisplayName(appPath: string): Promise<string | undefined> {
  if (!existsSync(appPath)) return undefined;
  const plist = path.join(appPath, "Contents", "Info.plist");
  for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
    const name = await exec("plutil", ["-extract", key, "raw", plist], 4000);
    if (name.trim()) return name.trim().slice(0, 60);
  }
  return path.basename(appPath).replace(/\.app$/i, "") || undefined;
}

/** 批量查 pid 的父进程与完整命令 */
async function psInfo(pids: number[]): Promise<Map<number, { ppid?: number; command?: string }>> {
  const map = new Map<number, { ppid?: number; command?: string }>();
  if (pids.length === 0) return map;
  const out = await exec("ps", ["-o", "pid=,ppid=,command=", "-p", [...new Set(pids)].join(",")], 2000);
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m) map.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] });
  }
  return map;
}

/** 批量查 pid 的工作目录 */
async function cwdInfo(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (pids.length === 0) return map;
  const out = await exec("lsof", ["-a", "-p", [...new Set(pids)].join(","), "-d", "cwd", "-Fn"], 2000);
  let cur = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) cur = Number(line.slice(1)) || 0;
    else if (line.startsWith("n") && cur) map.set(cur, line.slice(1));
  }
  return map;
}

export interface LaunchContext {
  command?: string;
  cwd?: string;
  parentCommand?: string;
}

export async function captureLaunchContexts(pids: number[]): Promise<Map<number, LaunchContext>> {
  const uniq = [...new Set(pids)].filter((p) => p > 1);
  const info = await psInfo(uniq);
  const parentPids = [...new Set([...info.values()].map((v) => v.ppid).filter((p): p is number => !!p && p > 1))];
  const parents = await psInfo(parentPids);
  for (const [pid, p] of parents) info.set(pid, { ppid: p.ppid, command: p.command });
  const cwds = await cwdInfo(uniq);

  const result = new Map<number, LaunchContext>();
  for (const pid of uniq) {
    const own = info.get(pid);
    const parent = own?.ppid ? info.get(own.ppid) : undefined;
    result.set(pid, {
      command: own?.command,
      cwd: cwds.get(pid),
      parentCommand: parent?.command,
    });
  }
  return result;
}

/** 从启动上下文推导重启配方;拿不到时返回原因(用于前端问号提示) */
export function buildRestartRecipe(ctx: LaunchContext): { recipe?: RestartRecipe; reason?: string } {
  const cmd = ctx.command?.trim();
  if (!cmd) {
    return { reason: "未能读取到该进程的启动命令（进程刚启动或已退出）。" };
  }

  // 第三方应用:路径里含 xxx.app/,可用 `open <xxx.app>` 重新拉起
  const appMatch = cmd.match(/^(\/.*?\.app)\//i);
  if (appMatch) {
    return { recipe: { kind: "app", appPath: appMatch[1] } };
  }

  // npm/pnpm/yarn 等脚本启动:node 系框架会改写进程标题导致自身参数丢失,
  // 但父进程(npm start / pnpm dev)原样保留,配合 cwd 可重启
  const pm = ctx.parentCommand?.trim().match(/^(npm|pnpm|yarn|bun|npx)\b\s*(.*)$/);
  if (pm && ctx.cwd) {
    const command = `${pm[1]}${pm[2] ? " " + pm[2].trim() : ""}`.trim();
    if (command.length <= 160) return { recipe: { kind: "script", cwd: ctx.cwd, command } };
  }

  // 直接以绝对路径启动的命令:argv 原样保留,可精确重启
  if (cmd.startsWith("/")) {
    const argv = cmd.split(/\s+/).slice(0, 64);
    if (argv[0] && existsSync(argv[0]) && !argv.some((a) => a.length > 1024)) {
      return { recipe: { kind: "argv", cwd: ctx.cwd, argv } };
    }
    return {
      reason:
        "该进程对应的可执行文件已不存在（可能是临时文件或已卸载），因此无法自动重启。请回到原来的终端重新启动。",
    };
  }

  return {
    reason:
      "该程序在运行时改写了进程名（例如 Next.js 会把进程显示为 next-server），系统层面的原始启动参数已被覆盖，无法自动重启。请回到原来的终端重新运行启动命令。",
  };
}
