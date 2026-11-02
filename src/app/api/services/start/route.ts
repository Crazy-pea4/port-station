import { NextResponse } from "next/server";
import { checkRequest } from "@/lib/api-security";
import { getRestart, claimRestart } from "@/lib/restart-store";
import { launchService } from "@/lib/launcher";
import { isListening } from "@/lib/port-check";

export const dynamic = "force-dynamic";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(request: Request) {
  const denied = checkRequest(request, true);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  if (!body || typeof body.restartId !== "string" || body.restartId.length > 100 ||
      Object.keys(body).some((key) => key !== "restartId")) {
    return NextResponse.json({ error: "需要服务端签发的重启记录" }, { status: 400 });
  }
  const record = getRestart(body.restartId);
  if (!record) return NextResponse.json({ error: "重启记录已过期，请回到终端启动" }, { status: 404 });
  const release = claimRestart(record);
  if (!release) return NextResponse.json({ error: "该服务已有启动请求，请等待端口恢复" }, { status: 409 });
  try {
    const { port, recipe } = record;
    // 同时检查 IPv4/IPv6,防止 ::1 上已有监听时重复启动。
    if (await isListening(port) || await isListening(port, "::1")) {
      release();
      return NextResponse.json({ error: `端口 ${port} 已被占用，请刷新列表` }, { status: 409 });
    }
    const launch = await launchService(recipe, release);
    for (let i = 0; i < 5; i++) {
      await sleep(600);
      if (launch.error || (launch.exited && (recipe.kind !== "app" || launch.exitCode !== 0))) {
        return NextResponse.json({ error: `启动进程已退出${launch.exitCode !== null ? `（退出码 ${launch.exitCode}）` : ""}。日志：${launch.logPath}` }, { status: 500 });
      }
      if (await isListening(port) || await isListening(port, "::1")) {
        return NextResponse.json({ spawned: true, listening: true, message: `端口 ${port} 已重新启动`, logPath: launch.logPath });
      }
    }
    // 未退出的启动进程继续持有锁;重复点击也不会再次 spawn。
    return NextResponse.json({ spawned: true, listening: false, message: recipe.kind === "app" ? "已发送打开命令，等待服务端口恢复" : "进程已启动，等待服务端口恢复", logPath: launch.logPath }, { status: 202 });
  } catch (error) {
    release();
    return NextResponse.json({ error: error instanceof Error ? error.message : "启动失败" }, { status: 500 });
  }
}
