import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isListening } from "@/lib/port-check";
import type { RestartRecipe } from "@/lib/types";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PM_WHITELIST = new Set(["npm", "pnpm", "yarn", "bun", "npx"]);

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function validPath(s: unknown): s is string {
  return typeof s === "string" && s.startsWith("/") && s.length <= 1024 && !s.includes("\0");
}

function validateRecipe(raw: unknown): { recipe: RestartRecipe; port: number } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "请求体格式不正确" };
  const body = raw as Record<string, unknown>;
  const port = body.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: "端口必须是 1 - 65535 之间的整数" };
  }
  const r = body.restart;
  if (typeof r !== "object" || r === null) return { error: "缺少重启配方" };
  const recipe = r as Record<string, unknown>;

  switch (recipe.kind) {
    case "argv": {
      const argv = recipe.argv;
      const cwd = recipe.cwd;
      if (
        !Array.isArray(argv) ||
        argv.length < 1 ||
        argv.length > 64 ||
        !argv.every((a) => typeof a === "string" && a.length > 0 && a.length <= 1024 && !a.includes("\0")) ||
        !validPath(argv[0]) ||
        !existsSync(argv[0])
      ) {
        return { error: "重启配方无效" };
      }
      if (cwd !== undefined && !validPath(cwd)) return { error: "重启配方无效" };
      return { recipe: { kind: "argv", cwd, argv: argv as string[] }, port };
    }
    case "script": {
      const cwd = recipe.cwd;
      const command = recipe.command;
      if (typeof command !== "string" || command.length === 0 || command.length > 160) {
        return { error: "重启配方无效" };
      }
      const first = command.split(/\s+/)[0];
      if (!PM_WHITELIST.has(first) || !/^[a-zA-Z0-9_@\/\.\- ]+$/.test(command)) {
        return { error: "重启配方无效" };
      }
      if (!validPath(cwd) || !existsSync(cwd)) return { error: "重启配方无效" };
      return { recipe: { kind: "script", cwd, command }, port };
    }
    case "app": {
      const appPath = recipe.appPath;
      if (!validPath(appPath) || !/^\/.*\.app$/i.test(appPath) || !existsSync(appPath)) {
        return { error: "重启配方无效" };
      }
      return { recipe: { kind: "app", appPath }, port };
    }
    default:
      return { error: "重启配方无效" };
  }
}

function spawnDetached(recipe: RestartRecipe, port: number) {
  const logPath = path.join(os.tmpdir(), `port-station-${port}.log`);

  let child;
  if (recipe.kind === "argv") {
    child = spawn(recipe.argv[0], recipe.argv.slice(1), {
      cwd: recipe.cwd,
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } else if (recipe.kind === "script") {
    const script = `cd ${shellQuote(recipe.cwd)} && exec ${recipe.command}`;
    child = spawn("/bin/zsh", ["-l", "-c", script], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } else {
    child = spawn("/usr/bin/open", [recipe.appPath], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
  }
  child.unref();
  void appendFile(logPath, `\n[${new Date().toISOString()}] spawn pid=${child.pid}\n`).catch(() => {});
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("请求体格式不正确");
  }

  const result = validateRecipe(body);
  if ("error" in result) return badRequest(result.error);
  const { recipe, port } = result;

  // 已有进程在监听则不再重复启动
  if (await isListening(port)) {
    return NextResponse.json({ spawned: false, listening: true, message: `端口 ${port} 已在监听` });
  }

  try {
    spawnDetached(recipe, port);
  } catch {
    return NextResponse.json({ error: "启动失败" }, { status: 500 });
  }

  // 给服务一点启动时间,再探测端口
  let listening = false;
  for (let i = 0; i < 5; i++) {
    await sleep(600);
    listening = await isListening(port);
    if (listening) break;
  }

  const message = listening
    ? `端口 ${port} 已重新启动`
    : recipe.kind === "app"
      ? "已发送打开命令"
      : "启动命令已发送，服务还在启动中";

  return NextResponse.json({ spawned: true, listening, message });
}
