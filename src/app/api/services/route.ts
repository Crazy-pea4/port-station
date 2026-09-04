import { NextResponse } from "next/server";
import { scanListeners, isUserLogin, isSystemProcess } from "@/lib/scan";
import { probeHttp } from "@/lib/port-check";
import {
  appDisplayName,
  buildRestartRecipe,
  captureLaunchContexts,
  packageProjectName,
} from "@/lib/restart";
import { updateSnapshot } from "@/lib/service-cache";
import type { ServiceInfo, ServicesPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

/** macOS 下路径位于 .app 包内的是 GUI 应用,其余视为本地启动的服务 */
function classify(command: string | undefined): "dev" | "app" {
  if (command && /\.app\//i.test(command)) return "app";
  return "dev";
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const selfPid = process.pid;
  const listeners = await scanListeners();

  // 只保留当前用户启动、非系统进程,并排除 Port Station 自身
  const mine = listeners.filter(
    (l) =>
      l.pid !== selfPid &&
      l.pid !== undefined &&
      isUserLogin(l.login) &&
      !isSystemProcess(l.process),
  );

  // 同一端口可能被多个进程共享
  const byPort = new Map<number, ServiceInfo>();
  for (const l of mine) {
    const existing = byPort.get(l.port);
    if (existing) {
      if (l.pid !== undefined) existing.pids.push(l.pid);
    } else {
      byPort.set(l.port, {
        port: l.port,
        pids: l.pid !== undefined ? [l.pid] : [],
        process: l.process ?? "unknown",
        category: "dev",
        checkedAt,
      });
    }
  }

  const services = [...byPort.values()];

  // 探测 HTTP:状态码 / 延迟 / 网页标题
  const htmlTitles = new Map<number, string | undefined>();
  await Promise.all(
    services.map(async (s) => {
      const http = await probeHttp(s.port);
      s.httpCode = http.httpCode;
      s.latencyMs = http.latencyMs;
      htmlTitles.set(s.port, http.htmlTitle);
    }),
  );

  const contexts = await captureLaunchContexts(services.flatMap((s) => s.pids));
  for (const s of services) {
    const ctx = s.pids.map((p) => contexts.get(p)).find((c) => c?.command);
    if (ctx) {
      s.command = ctx.command;
      s.category = classify(ctx.command);
      const { recipe, reason } = buildRestartRecipe(ctx);
      s.restart = recipe;
      s.noRestartReason = recipe ? undefined : reason;

      // 标题解析:项目名 → 网页标题 → 应用显示名 → 进程名
      if (s.category === "app") {
        const m = ctx.command?.match(/^(\/.*?\.app)\//i);
        const name = m ? await appDisplayName(m[1]) : undefined;
        s.title = name ?? s.process;
        s.titleSource = name ? "app" : "process";
      } else {
        const pkg = packageProjectName(ctx.cwd);
        if (pkg) {
          s.title = pkg;
          s.titleSource = "package";
        } else if (htmlTitles.get(s.port)) {
          s.title = htmlTitles.get(s.port);
          s.titleSource = "html";
        } else {
          s.title = s.process;
          s.titleSource = "process";
        }
      }
    } else {
      s.noRestartReason = "未能读取到该进程的启动命令（进程刚启动或已退出）。";
      s.title = s.process;
      s.titleSource = "process";
    }
  }
  services.sort((a, b) => a.port - b.port);
  updateSnapshot(services);

  const payload: ServicesPayload = {
    services,
    scanned: listeners.length,
    checkedAt,
  };
  return NextResponse.json(payload);
}
