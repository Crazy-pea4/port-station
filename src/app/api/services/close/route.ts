import { NextResponse } from "next/server";
import { scanListeners, isUserLogin } from "@/lib/scan";
import type { CloseResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pidsOnPort(port: number): Promise<number[]> {
  const selfPid = process.pid;
  const listeners = await scanListeners();
  return [
    ...new Set(
      listeners
        .filter(
          (l) =>
            l.port === port &&
            l.pid !== undefined &&
            l.pid !== selfPid &&
            isUserLogin(l.login),
        )
        .map((l) => l.pid as number),
    ),
  ];
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  const port = (body as { port?: unknown })?.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "端口必须是 1 - 65535 之间的整数" }, { status: 400 });
  }

  const pids = await pidsOnPort(port);
  if (pids.length === 0) {
    return NextResponse.json(
      { error: `端口 ${port} 上没有可关闭的用户进程` },
      { status: 404 },
    );
  }

  // 先礼貌地 SIGTERM,等 1.5 秒;仍在则 SIGKILL
  let forced = false;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // 进程可能刚好自己退出了
    }
  }
  await sleep(1500);
  let remaining = await pidsOnPort(port);
  if (remaining.length > 0) {
    forced = true;
    for (const pid of remaining) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
    await sleep(500);
    remaining = await pidsOnPort(port);
  }

  const result: CloseResult = {
    closed: remaining.length === 0,
    forced,
    pids,
    message:
      remaining.length === 0
        ? forced
          ? `已强制结束进程 ${pids.join(", ")}`
          : `已结束进程 ${pids.join(", ")}`
        : `部分进程 ${remaining.join(", ")} 未能结束`,
  };
  return NextResponse.json(result);
}
