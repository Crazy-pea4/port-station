import { execFile } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { recipeError, type PackageManager, type RestartRecipe } from "./restart-recipe";

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
  /** 仅来自保留边界的操作系统接口,绝不从 ps 字符串 split 得到 */
  argv?: string[];
}

function readArgv(pid: number): string[] | undefined {
  if (process.platform !== "linux") return;
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    if (argv.at(-1) === "") argv.pop();
    const executable = readlinkSync(`/proc/${pid}/exe`);
    // 进程标题被改写时,第一项不再对应可执行文件,不得误当成真实 argv。
    if (!argv[0] || path.basename(argv[0]) !== path.basename(executable)) return;
    argv[0] = executable;
    return argv;
  } catch {
    return;
  }
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
      argv: readArgv(pid),
    });
  }
  return result;
}

/** 从启动上下文推导重启配方;拿不到时返回原因(用于前端问号提示) */
export function buildRestartRecipe(ctx: LaunchContext): { recipe?: RestartRecipe; reason?: string } {
  const usable = (recipe: RestartRecipe) => {
    const reason = recipeError(recipe);
    return reason ? { reason } : { recipe };
  };
  const cmd = ctx.command?.trim();
  if (!cmd) {
    return { reason: "未能读取到该进程的启动命令（进程刚启动或已退出）。" };
  }

  // 第三方应用:路径里含 xxx.app/,可用 `open <xxx.app>` 重新拉起
  const appMatch = cmd.match(/^(\/.*?\.app)\//i);
  if (appMatch) {
    return usable({ kind: "app", appPath: appMatch[1] });
  }

  // 只识别不带额外参数的完整项目脚本标题。ps 无法保留额外参数的边界。
  const pm = ctx.parentCommand?.trim().match(/^(npm|pnpm|yarn|bun)\s+(?:run(?:-script)?\s+)?([\w@:.\/-]+)$/);
  if (pm && ctx.cwd) {
    return usable({ kind: "script", cwd: ctx.cwd, manager: pm[1] as PackageManager, script: pm[2], args: [] });
  }

  if (ctx.argv && ctx.cwd) {
    return usable({ kind: "argv", cwd: ctx.cwd, argv: ctx.argv });
  }

  return {
    reason:
      "系统未提供可可靠恢复的原始参数（ps 命令文本不保留参数边界，框架也可能改写标题）。请回到原来的终端重新启动。",
  };
}
