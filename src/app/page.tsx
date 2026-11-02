"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CloseResult, ServiceInfo, ServicesPayload } from "@/lib/types";
import { ServiceCard } from "@/components/service-card";
import { ClosedServiceCard } from "@/components/closed-service-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Footer } from "@/components/footer";
import { LogoMark, RefreshIcon, SearchIcon } from "@/components/icons";

const HIDDEN_KEY = "ps-hidden-ports";
const EMPTY_SERVICES: ServiceInfo[] = [];

type CategoryTab = "dev" | "app";

const CATEGORY_TABS: Array<{ key: CategoryTab; label: string }> = [
  { key: "dev", label: "本地服务" },
  { key: "app", label: "第三方应用" },
];

export default function Home() {
  const [data, setData] = useState<ServicesPayload | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<CategoryTab>("dev");
  const [hidden, setHidden] = useState<number[]>([]);
  const [closing, setClosing] = useState<ServiceInfo | null>(null);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closedList, setClosedList] = useState<Array<{ service: ServiceInfo; closedAt: number }>>([]);
  const [startingPorts, setStartingPorts] = useState<number[]>([]);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshVersion = useRef(0);
  const token = useRef("");

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message });
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(HIDDEN_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(parsed)) {
          setHidden(parsed.filter((p): p is number => typeof p === "number"));
        }
      } catch {
        // 忽略损坏或不可用的本地存储
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const version = ++refreshVersion.current;
    if (!opts?.silent) setRefreshing(true);
    try {
      const res = await fetch("/api/services", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const payload = (await res.json()) as ServicesPayload;
      if (version !== refreshVersion.current) return;
      token.current = payload.sessionToken;
      setData(payload);
      setLoadError(false);
      // 只有"晚于关闭时刻"的扫描再次发现该端口(说明服务被重新启动),才移除驻留卡;
      // 关闭瞬间在途的过期扫描结果不得清除驻留卡
      setClosedList((prev) =>
        prev.filter((c) => {
          const s = payload.services.find((x) => x.port === c.service.port);
          return !(s && new Date(payload.checkedAt).getTime() > c.closedAt);
        }),
      );
    } catch {
      if (version === refreshVersion.current) setLoadError(true);
    } finally {
      if (version === refreshVersion.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh({ silent: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const hidePort = useCallback(
    (service: ServiceInfo) => {
      const next = [...new Set([...hidden, service.port])];
      setHidden(next);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        // 存储受限时仍允许本次页面会话内隐藏
      }
      showToast(`端口 ${service.port} 已隐藏，不再显示`);
    },
    [hidden, showToast],
  );

  const restoreHidden = useCallback(() => {
    setHidden([]);
    try {
      localStorage.removeItem(HIDDEN_KEY);
    } catch {
      // 存储受限时仍更新当前页面
    }
    showToast("已恢复显示全部端口");
  }, [showToast]);

  const allServices = data?.services ?? EMPTY_SERVICES;

  const categoryCounts = useMemo(
    () => ({
      dev: allServices.filter((s) => s.category === "dev").length,
      app: allServices.filter((s) => s.category === "app").length,
    }),
    [allServices],
  );

  const services = useMemo(
    () =>
      allServices.filter((s) => {
        if (s.category !== tab || hidden.includes(s.port)) return false;
        // 该端口刚被关闭(驻留中)时,压制仍带着过期检测时间的运行卡,避免双卡同现
        const closed = closedList.find((c) => c.service.port === s.port);
        if (closed && new Date(s.checkedAt).getTime() < closed.closedAt) return false;
        return true;
      }),
    [allServices, tab, hidden, closedList],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((s) => {
      if (!q) return true;
      return (
        String(s.port).includes(q) ||
        s.process.toLowerCase().includes(q) ||
        s.pids.some((p) => String(p).includes(q))
      );
    });
  }, [services, query]);

  // 已关闭的驻留卡片:按当前标签与搜索条件过滤
  const closedVisible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return closedList.filter(({ service: s }) => {
      if (s.category !== tab || hidden.includes(s.port)) return false;
      if (!q) return true;
      return (
        String(s.port).includes(q) ||
        s.process.toLowerCase().includes(q) ||
        s.pids.some((p) => String(p).includes(q))
      );
    });
  }, [closedList, tab, hidden, query]);

  async function handleClose() {
    if (!closing || closeBusy) return;
    setCloseBusy(true);
    const snapshot = closing;
    try {
      const res = await fetch("/api/services/close", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Port-Station-Token": token.current },
        body: JSON.stringify({ port: snapshot.port, targets: snapshot.targets }),
      });
      const payload = (await res.json().catch(() => ({}))) as CloseResult & { error?: string };
      if (!res.ok) {
        showToast(payload.error ?? "关闭失败，请重试");
      } else if (payload.closed) {
        // 驻留在页面内存中,方便再次启动;刷新页面即消失
        ++refreshVersion.current;
        if (snapshot.category === "dev" || payload.restartId) {
          const closedAt = Date.now();
          const closedService = { ...snapshot, restartId: payload.restartId, restartable: !!payload.restartId, noRestartReason: payload.noRestartReason };
          setClosedList((prev) =>
            [{ service: closedService, closedAt }, ...prev.filter((c) => c.service.port !== snapshot.port)].slice(0, 12),
          );
        }
        // 立即从运行列表同步移除,防止驻留卡与运行卡短暂同现
        setData((prev) =>
          prev ? { ...prev, services: prev.services.filter((s) => s.port !== snapshot.port) } : prev,
        );
        showToast(payload.message);
      } else {
        showToast(payload.message || "关闭失败，请重试");
      }
      setClosing(null);
      await refresh({ silent: true });
    } catch {
      showToast("网络异常，请重试");
    } finally {
      setCloseBusy(false);
    }
  }

  async function handleRestart(service: ServiceInfo) {
    if (!service.restartId || startingPorts.includes(service.port)) return;
    setStartingPorts((prev) => [...prev, service.port]);
    try {
      const res = await fetch("/api/services/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Port-Station-Token": token.current },
        body: JSON.stringify({ restartId: service.restartId }),
      });
      const payload = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      showToast(res.ok ? (payload.message ?? "启动命令已发送") : (payload.error ?? "启动失败，请重试"));
      await refresh({ silent: true });
    } catch {
      showToast("网络异常，请重试");
    } finally {
      setStartingPorts((prev) => prev.filter((p) => p !== service.port));
    }
  }

  function formatTime(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
  }

  return (
    <div className="flex min-h-screen flex-col bg-ps-canvas-light">
      <header className="sticky top-0 z-40 border-b border-ps-hairline-light bg-ps-canvas-light">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-5 md:px-8">
          <div className="flex items-center gap-2.5">
            <LogoMark className="h-6 w-6" />
            <span className="text-[15px] font-medium tracking-[0.4px] text-ps-ink">PORT STATION</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-[12px] font-medium text-ps-mute sm:block">
              {data ? `${services.length} 个服务 · 检测于 ${formatTime(data.checkedAt)}` : "正在扫描…"}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              aria-label="刷新"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-ps-ash px-4 text-[13px] font-bold tracking-[0.3px] text-ps-ink transition-colors hover:border-ps-ink disabled:opacity-60"
            >
              <RefreshIcon className={`h-3.5 w-3.5 ${refreshing ? "ps-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-[1200px] px-5 py-10 md:px-8 md:py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[28px] font-light leading-[1.25] tracking-[0.1px] md:text-[35px]">
                运行中的服务
              </h1>
              <p className="mt-1 text-[14px] text-ps-mute">
                自动发现本机监听端口，已过滤系统进程；每 5 秒检测一次
              </p>
            </div>
            <div className="relative w-full sm:w-80">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ps-mute" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索端口、进程或 PID…"
                className="h-11 w-full rounded-[4px] border border-ps-ash bg-white pl-10 pr-4 text-[14px] text-ps-ink placeholder:text-ps-mute focus:border-ps-blue focus:shadow-[inset_0_0_0_1px_#0070d1] focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex gap-1 rounded-full bg-ps-soft p-1">
              {CATEGORY_TABS.map((t) => {
                const active = tab === t.key;
                const count = categoryCounts[t.key];
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-bold tracking-[0.324px] transition-colors ${
                      active ? "bg-white text-ps-ink" : "text-ps-mute hover:text-ps-ink"
                    }`}
                  >
                    {t.label}
                    <span className={`text-[12px] font-medium tabular-nums ${active ? "text-ps-mute" : ""}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {hidden.length > 0 && (
              <button
                type="button"
                onClick={restoreHidden}
                className="text-[13px] font-medium text-ps-link-light hover:underline"
              >
                已隐藏 {hidden.length} 个端口 · 恢复显示
              </button>
            )}
          </div>

          {loadError && (
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ps-warning px-5 py-4 text-white">
              <p className="text-[14px] font-medium">无法获取服务列表，请确认 Port Station 正在运行。</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-bold text-ps-warning"
              >
                <RefreshIcon className="h-4 w-4" />
                重试
              </button>
            </div>
          )}

          {data !== null && !loadError && filtered.length === 0 && closedVisible.length === 0 && (
            <div className="mt-8 flex flex-col items-center rounded-lg bg-ps-card px-6 py-20 text-center">
              <div className="flex gap-2" aria-hidden="true">
                <span className="h-3 w-3 rounded-full bg-ps-ash" />
                <span className="h-3 w-3 rounded-full bg-ps-blue" />
                <span className="h-3 w-3 rounded-full bg-ps-ash" />
              </div>
              <h2 className="mt-5 font-display text-[22px] font-light leading-[1.25]">
                {services.length === 0
                  ? tab === "dev"
                    ? "当前没有本地开发服务在运行"
                    : "没有第三方应用占用端口"
                  : "没有匹配的服务"}
              </h2>
              <p className="mt-2 max-w-[420px] text-[16px] leading-[1.5] text-ps-body-light">
                {services.length === 0
                  ? tab === "dev"
                    ? "启动你的 dev server 后，它会自动出现在这里；QQ、微信等第三方应用的端口不会显示。"
                    : "切换到「本地服务」查看你启动的开发服务。"
                  : "换个关键词试试。"}
              </p>
            </div>
          )}

          {(filtered.length > 0 || closedVisible.length > 0) && (
            <div className="mt-8 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((s) => (
                <ServiceCard
                  key={s.port}
                  service={s}
                  onHide={(service) => hidePort(service)}
                  onClose={(service) => setClosing(service)}
                />
              ))}
              {closedVisible.map(({ service, closedAt }) => (
                <ClosedServiceCard
                  key={`closed-${service.port}`}
                  service={service}
                  closedAt={closedAt}
                  starting={startingPorts.includes(service.port)}
                  onDiscard={(s) => setClosedList((prev) => prev.filter((c) => c.service.port !== s.port))}
                  onRestart={(s) => void handleRestart(s)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <Footer />

      <ConfirmDialog
        open={closing !== null}
        title={`关闭端口 ${closing?.port ?? ""}？`}
        body={
          closing
            ? `「${closing.process}」（PID ${closing.pids.join(", ")}）正在监听端口 ${closing.port}。关闭会终止该进程，未保存的数据可能丢失。`
            : ""
        }
        confirmText="关闭服务"
        busy={closeBusy}
        onConfirm={() => void handleClose()}
        onClose={() => setClosing(null)}
      />

      {toast && (
        <div key={toast.id} className="ps-toast-in fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
          <div className="flex h-12 items-center rounded-full bg-ps-ink-deep px-6 text-[14px] font-medium text-white shadow-[0_4px_12px_rgba(0,0,0,0.16)]">
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
