"use client";

import type { ServiceInfo } from "@/lib/types";
import { CloseIcon, ExternalIcon, PowerIcon } from "./icons";
import { ServiceIcon } from "./service-icon";

interface ServiceCardProps {
  service: ServiceInfo;
  onHide: (service: ServiceInfo) => void;
  onClose: (service: ServiceInfo) => void;
}

export function ServiceCard({ service, onHide, onClose }: ServiceCardProps) {
  const httpOk = service.httpCode !== undefined;
  const url = `http://localhost:${service.port}`;

  return (
    <article className="flex flex-col rounded-lg bg-ps-card p-6 transition-shadow active:shadow-[0_4px_12px_rgba(0,0,0,0.16)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5" title={service.command}>
          <ServiceIcon port={service.port} version={service.pids[0] ?? 0} />
          <span
            className="min-w-0 truncate text-[15px] font-semibold text-ps-ink"
            title={service.title}
          >
            {service.title ?? service.process}
          </span>
          <span
            className={`inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium ${
              service.category === "dev"
                ? "bg-ps-blue text-white"
                : "bg-ps-soft text-ps-mute"
            }`}
          >
            {service.process}
          </span>
          <span className="shrink-0 text-[12px] font-medium text-ps-mute tabular-nums">
            PID {service.pids.join(", ")}
          </span>
        </div>
        <button
          type="button"
          aria-label={`不再显示端口 ${service.port}`}
          title="不再显示"
          onClick={() => onHide(service)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ps-mute transition-colors hover:bg-ps-soft hover:text-ps-ink"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-4 flex items-baseline gap-2 tabular-nums">
        <span className="font-display text-[34px] font-light leading-none">{service.port}</span>
        <span className="text-[12px] font-medium text-ps-mute">端口</span>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-[14px] font-medium text-ps-link-light hover:underline"
        >
          localhost:{service.port}
        </a>
        <span className={`shrink-0 text-[12px] tabular-nums ${httpOk ? "text-ps-mute" : "text-ps-ash"}`}>
          {httpOk
            ? `HTTP ${service.httpCode}${service.latencyMs !== undefined ? ` · ${service.latencyMs}ms` : ""}`
            : "非 HTTP 服务"}
        </span>
      </div>

      <div className="mt-5 flex gap-2 border-t border-ps-hairline-light pt-4">
        {httpOk ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-ps-blue px-5 text-[14px] font-bold tracking-[0.324px] text-white transition-colors active:bg-ps-blue-pressed"
          >
            打开
            <ExternalIcon className="h-3.5 w-3.5" />
          </a>
        ) : (
          <span
            aria-disabled="true"
            title="该端口没有 HTTP 响应，无法在浏览器打开"
            className="inline-flex h-10 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-full bg-ps-soft px-5 text-[14px] font-bold tracking-[0.324px] text-ps-ash"
          >
            打开
            <ExternalIcon className="h-3.5 w-3.5" />
          </span>
        )}
        <button
          type="button"
          onClick={() => onClose(service)}
          disabled={service.targets.length !== service.pids.length || !service.targets.length}
          title={service.targets.length !== service.pids.length ? "无法核对进程身份，请刷新后重试" : undefined}
          className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border border-ps-ash px-5 text-[14px] font-bold tracking-[0.324px] text-ps-ink transition-colors hover:border-ps-warning hover:text-ps-warning active:bg-ps-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PowerIcon className="h-3.5 w-3.5" />
          关闭
        </button>
      </div>
    </article>
  );
}
