"use client";

import { useState } from "react";

/** 卡片左上角的服务图标:HTTP 服务抓 favicon,第三方应用取 .app 包内图标;失败显示占位 */
export function ServiceIcon({ port, version }: { port: number; version: string | number }) {
  const src = `/api/services/icon?port=${port}&v=${version}`;
  return <IconImage key={src} src={src} />;
}

function IconImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] bg-ps-soft text-ps-ash"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
          <circle cx="6" cy="6" r="2.2" />
          <circle cx="11" cy="6" r="2.2" />
          <circle cx="6" cy="11" r="2.2" />
          <rect x="9" y="9" width="4.2" height="4.2" rx="1.2" />
        </svg>
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      onError={() => setFailed(true)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className="h-7 w-7 shrink-0 rounded-[6px] border border-ps-hairline-light bg-white object-contain p-[2px]"
    />
  );
}

/** 问号图标,hover 显示无法自动重启的具体原因 */
export function ReasonTip({ reason }: { reason: string }) {
  return (
    <span className="group relative inline-flex" tabIndex={0} aria-label={reason}>
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 cursor-help text-ps-mute transition-colors group-hover:text-ps-ink"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9.2a2.6 2.6 0 1 1 3.5 2.44c-.72.27-1.1.8-1.1 1.56v.3" />
        <path d="M12 16.6v.01" strokeWidth="2.6" />
      </svg>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-64 rounded-lg bg-ps-ink-deep px-3.5 py-2.5 text-[12px] font-normal leading-[1.6] tracking-normal text-white opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.24)] transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {reason}
        <span className="absolute left-full top-full -ml-1 border-[5px] border-transparent border-t-ps-ink-deep" />
      </span>
    </span>
  );
}
