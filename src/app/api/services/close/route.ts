import { NextResponse } from "next/server";
import { checkRequest } from "@/lib/api-security";
import { scanListeners, isUserLogin, isSystemProcess } from "@/lib/scan";
import { getSeenService } from "@/lib/service-cache";
import { readProcessIdentities, sameProcess, signalOriginal } from "@/lib/process-identity";
import { buildRestartRecipe, captureLaunchContexts } from "@/lib/restart";
import { saveRestart } from "@/lib/restart-store";
import type { CloseResult, ProcessIdentity } from "@/lib/types";

export const dynamic = "force-dynamic";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function validTarget(target: unknown): target is ProcessIdentity {
  if (!target || typeof target !== "object") return false;
  const t = target as ProcessIdentity;
  return Number.isInteger(t.pid) && t.pid > 1 && Number.isInteger(t.uid) &&
    typeof t.startedAt === "string" && t.startedAt.length > 0 && t.startedAt.length < 100;
}

async function remainingOriginals(targets: ProcessIdentity[]): Promise<ProcessIdentity[]> {
  const current = await readProcessIdentities(targets.map((target) => target.pid));
  return targets.filter((target) => {
    const identity = current.get(target.pid);
    return identity && sameProcess(target, identity);
  });
}

export async function POST(request: Request) {
  const denied = checkRequest(request, true);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体格式不正确" }, { status: 400 });
  }
  const port = body?.port;
  const targets: unknown = body?.targets;
  if (!Number.isInteger(port) || port < 1 || port > 65535 ||
      !Array.isArray(targets) || !targets.length || targets.length > 128 || !targets.every(validTarget) ||
      new Set(targets.map((target) => target.pid)).size !== targets.length) {
    return NextResponse.json({ error: "需要有效的端口和原进程身份，请刷新后重试" }, { status: 400 });
  }

  const conflict = () => NextResponse.json({ error: "进程或端口归属已变化，请刷新后重新确认" }, { status: 409 });
  const service = getSeenService(port);
  if (!service || service.targets.length !== targets.length || service.pids.length !== targets.length ||
      !targets.every((target) => service.targets.some((known) => sameProcess(target, known)))) return conflict();

  try {
    const listeners = (await scanListeners()).filter((listener) => listener.port === port);
    const owners = new Set(listeners.map((listener) => listener.pid));
    if (owners.size !== targets.length || !targets.every((target) => owners.has(target.pid)) ||
        listeners.some((listener) => !isUserLogin(listener.login) || isSystemProcess(listener.process)) ||
        targets.some((target) => target.pid === process.pid || target.uid !== process.getuid?.())) return conflict();
    if ((await remainingOriginals(targets)).length !== targets.length) return conflict();

    // 在结束进程前重新捕获,重启参数始终留在服务端。
    const contexts = await captureLaunchContexts(targets.map((target) => target.pid));
    const context = targets.map((target) => contexts.get(target.pid)).find((ctx) => ctx?.command);
    const restart = context ? buildRestartRecipe(context) : { reason: "无法读取原进程的启动参数" };

    for (const target of targets) await signalOriginal(target, "SIGTERM");
    await sleep(1500);
    let remaining = await remainingOriginals(targets);
    let forced = false;
    for (const target of remaining) {
      if (await signalOriginal(target, "SIGKILL")) forced = true;
    }
    if (remaining.length) {
      await sleep(500);
      remaining = await remainingOriginals(targets);
    }
    const closed = remaining.length === 0;
    const result: CloseResult = {
      closed,
      forced,
      pids: targets.map((target) => target.pid),
      message: closed ? `已${forced ? "强制" : ""}结束原进程 ${targets.map((target) => target.pid).join(", ")}`
        : `原进程 ${remaining.map((target) => target.pid).join(", ")} 未能结束`,
      restartId: closed && restart.recipe ? saveRestart(port, restart.recipe) : undefined,
      noRestartReason: restart.reason,
    };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "关闭失败，请刷新后重试" }, { status: 503 });
  }
}
