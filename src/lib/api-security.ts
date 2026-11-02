import { randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

// Route bundles 和开发热更新共享同一个进程内令牌。
const state = globalThis as typeof globalThis & { portStationToken?: string };
export function sessionToken(): string {
  return (state.portStationToken ??= randomBytes(32).toString("hex"));
}

export function checkRequest(request: Request, mutation = false): Response | undefined {
  const deny = () => NextResponse.json({ error: "仅允许从本机控制台访问" }, { status: 403 });
  const host = request.headers.get("host");
  if (!host) return deny();
  let origin: string;
  try {
    const url = new URL(`${new URL(request.url).protocol}//${host}`);
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.host !== host || url.username || url.password || url.pathname !== "/"
    ) return deny();
    origin = url.origin;
  } catch {
    return deny();
  }
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin && suppliedOrigin !== origin) return deny();
  if (request.headers.get("sec-fetch-site") === "cross-site") return deny();
  if (mutation) {
    if (suppliedOrigin !== origin) return deny();
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return NextResponse.json({ error: "需要 application/json 请求" }, { status: 415 });
    }
    const token = request.headers.get("x-port-station-token") ?? "";
    const expected = sessionToken();
    if (!/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return deny();
    }
  }
}
