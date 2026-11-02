import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSeenService } from "@/lib/service-cache";
import { checkRequest } from "@/lib/api-security";

export const dynamic = "force-dynamic";

interface Icon {
  buf: Buffer;
  type: string;
}

// 内存缓存:避免每次轮询都去抓取/转换
const httpCache = new Map<number, { icon?: Icon; at: number }>();
const appCache = new Map<string, { icon?: Icon; at: number }>();
const HTTP_TTL_MS = 5 * 60_000;
const NEG_TTL_MS = 60_000;
const APP_TTL_MS = 60 * 60_000;
const MAX_BYTES = 512 * 1024;

function fetchWithTimeout(url: string, timeoutMs = 1500): Promise<Response | null> {
  return fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "PortStation/1.0" },
    cache: "no-store",
    redirect: "follow",
  }).catch(() => null);
}

function sniffImage(buf: Buffer): string | null {
  if (buf.length < 8 || buf.length > MAX_BYTES) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return "image/x-icon";
  if (buf[0] === 0x3c && buf.subarray(0, 200).toString("utf8").toLowerCase().includes("<svg")) {
    return "image/svg+xml";
  }
  return null;
}

async function fetchImage(url: string): Promise<Icon | null> {
  const res = await fetchWithTimeout(url);
  if (!res || !res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const type = sniffImage(buf);
  return type ? { buf, type } : null;
}

async function fetchHttpIcon(port: number): Promise<Icon | null> {
  const origin = `http://127.0.0.1:${port}`;
  const direct = await fetchImage(`${origin}/favicon.ico`);
  if (direct) return direct;

  // 解析首页 <link rel="icon" href="...">
  const res = await fetchWithTimeout(origin + "/");
  if (!res || !res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html")) return null;
  const html = (await res.text()).slice(0, 200_000);
  const linkTag = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0];
  if (!linkTag) return null;
  const href = linkTag.match(/href=["']([^"']+)["']/i)?.[1];
  if (!href) return null;
  try {
    return await fetchImage(new URL(href, origin).toString());
  } catch {
    return null;
  }
}

function execP(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      resolve(err ? "" : (stdout ?? "").trim());
    });
  });
}

/** 从 .app 包内提取应用图标(icns → png) */
async function fetchAppIcon(appPath: string): Promise<Icon | null> {
  const resDir = path.join(appPath, "Contents", "Resources");
  if (!existsSync(resDir)) return null;

  let icns: string | null = null;
  try {
    const plist = path.join(appPath, "Contents", "Info.plist");
    const name = await execP("plutil", ["-extract", "CFBundleIconFile", "raw", plist]);
    if (name) {
      const withExt = name.endsWith(".icns") ? name : `${name}.icns`;
      const candidate = path.join(resDir, withExt);
      if (existsSync(candidate)) icns = candidate;
    }
  } catch {
    // Info.plist 中没有 CFBundleIconFile,退回到扫描 Resources 目录
  }

  if (!icns) {
    try {
      const candidates = readdirSync(resDir)
        .filter((f) => f.endsWith(".icns"))
        .map((f) => path.join(resDir, f))
        .sort((a, b) => statSync(b).size - statSync(a).size);
      icns = candidates[0] ?? null;
    } catch {
      return null;
    }
  }
  if (!icns) return null;

  const outPng = path.join(os.tmpdir(), `port-station-icon-${path.basename(appPath)}.png`);
  const converted = await execP("sips", ["-s", "format", "png", icns, "--out", outPng], 8000);
  if (!converted || !existsSync(outPng)) return null;
  const { readFile, rm } = await import("node:fs/promises");
  try {
    const buf = await readFile(outPng);
    const type = sniffImage(buf);
    return type ? { buf, type } : null;
  } finally {
    void rm(outPng, { force: true }).catch(() => {});
  }
}

export async function GET(request: Request) {
  const denied = checkRequest(request);
  if (denied) return denied;
  const port = Number(new URL(request.url).searchParams.get("port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: "端口无效" }, { status: 400 });
  }
  const service = getSeenService(port);
  if (!service) return new NextResponse(null, { status: 404 });

  let icon: Icon | undefined;
  if (service.category === "app") {
    const appMatch = service.command?.match(/^(\/.*?\.app)\//i);
    if (appMatch) {
      const cached = appCache.get(appMatch[1]);
      if (cached && Date.now() - cached.at < APP_TTL_MS) {
        icon = cached.icon;
      } else {
        icon = (await fetchAppIcon(appMatch[1])) ?? undefined;
        appCache.set(appMatch[1], { icon, at: Date.now() });
      }
    }
  } else {
    const cached = httpCache.get(port);
    const ttl = cached?.icon ? HTTP_TTL_MS : NEG_TTL_MS;
    if (cached && Date.now() - cached.at < ttl) {
      icon = cached.icon;
    } else {
      icon = (await fetchHttpIcon(port)) ?? undefined;
      httpCache.set(port, { icon, at: Date.now() });
    }
  }

  if (!icon) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(icon.buf), {
    headers: {
      "Content-Type": icon.type,
      "Cache-Control": "private, max-age=300",
    },
  });
}
