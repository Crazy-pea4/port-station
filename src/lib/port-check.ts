import net from "node:net";
import { execFile } from "node:child_process";

const TCP_TIMEOUT_MS = 800;
const HTTP_TIMEOUT_MS = 1500;
const LSOF_TIMEOUT_MS = 1500;

export function isListening(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(TCP_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

export function getPortOwner(port: number): Promise<{ pid?: number; process?: string }> {
  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-F", "pcn"],
      { timeout: LSOF_TIMEOUT_MS },
      (err, stdout) => {
        if (err || !stdout) {
          resolve({});
          return;
        }
        let pid: number | undefined;
        let processName: string | undefined;
        for (const line of stdout.split("\n")) {
          if (line.startsWith("p") && !pid) pid = Number(line.slice(1)) || undefined;
          if (line.startsWith("c") && !processName) processName = line.slice(1) || undefined;
        }
        resolve({ pid, process: processName });
      },
    );
  });
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

/** 从 HTML 里解析 <title>,过滤目录列表等无意义标题 */
export function extractHtmlTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i);
  if (!m) return undefined;
  const t = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  if (!t || /^index of\b/i.test(t)) return undefined;
  return t.slice(0, 80);
}

export async function probeHttp(
  port: number,
): Promise<{ httpCode?: number; latencyMs?: number; htmlTitle?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: controller.signal,
      headers: { "User-Agent": "PortStation/1.0" },
      cache: "no-store",
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    let htmlTitle: string | undefined;
    if (res.ok && (res.headers.get("content-type") ?? "").includes("html")) {
      try {
        htmlTitle = extractHtmlTitle((await res.text()).slice(0, 200_000));
      } catch {
        // 忽略读取失败的响应体
      }
    } else {
      try {
        await res.body?.cancel();
      } catch {
        // 流可能已被释放
      }
    }
    return { httpCode: res.status, latencyMs, htmlTitle };
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
