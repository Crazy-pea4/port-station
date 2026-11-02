"use client";

import type { ServiceInfo } from "@/lib/types";
import { CloseIcon, PowerIcon } from "./icons";
import { ReasonTip, ServiceIcon } from "./service-icon";

interface ClosedServiceCardProps {
  service: ServiceInfo;
  closedAt: number;
  starting: boolean;
  onDiscard: (service: ServiceInfo) => void;
  onRestart: (service: ServiceInfo) => void;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour12: false });
}

export function ClosedServiceCard({ service, closedAt, starting, onDiscard, onRestart }: ClosedServiceCardProps) {
  const restartable = !!service.restartId;

  return (
    <article className="flex flex-col rounded-lg border border-dashed border-ps-ash bg-white p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5" title={service.command}>
          <ServiceIcon port={service.port} version={closedAt} />
          <span
            className="min-w-0 truncate text-[15px] font-semibold text-ps-ink"
            title={service.title}
          >
            {service.title ?? service.process}
          </span>
          <span className="inline-flex h-6 shrink-0 items-center rounded-full bg-ps-warning/10 px-2.5 text-[12px] font-medium text-ps-warning">
            已关闭
          </span>
        </div>
        <button
          type="button"
          aria-label={`移除端口 ${service.port} 的关闭记录`}
          title="从列表移除"
          onClick={() => onDiscard(service)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ps-mute transition-colors hover:bg-ps-soft hover:text-ps-ink"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-4 flex items-baseline gap-2 tabular-nums">
        <span className="font-display text-[34px] font-light leading-none text-ps-mute">{service.port}</span>
        <span className="text-[12px] font-medium text-ps-mute">端口</span>
      </div>

      <p className="mt-2 truncate text-[12px] font-medium text-ps-mute">
        {service.process} · {formatTime(closedAt)} 关闭 · 刷新页面后不再显示
      </p>

      <div className="mt-auto pt-5">
        {restartable ? (
          <button
            type="button"
            onClick={() => onRestart(service)}
            disabled={starting}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-ps-blue px-5 text-[14px] font-bold tracking-[0.324px] text-white transition-colors active:bg-ps-blue-pressed disabled:bg-ps-soft disabled:text-ps-ash"
          >
            <PowerIcon className="h-3.5 w-3.5" />
            {starting ? "启动中…" : "重新启动"}
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-[4px] bg-ps-soft px-4 py-2.5">
            <span className="text-[12px] font-medium text-ps-mute">无法自动重启</span>
            <ReasonTip
              reason={service.noRestartReason ?? "未能获取该进程的启动参数，无法自动重启。请回到原来的终端重新启动。"}
            />
          </div>
        )}
      </div>
    </article>
  );
}
