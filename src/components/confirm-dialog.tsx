"use client";

import { useEffect } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmText: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmText,
  busy,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="ps-dialog-in w-full max-w-[400px] rounded-2xl bg-white p-6 md:p-8"
      >
        <h2 className="font-display text-[22px] font-light leading-[1.25] tracking-[0.1px]">
          {title}
        </h2>
        <p className="mt-3 text-[16px] leading-[1.5] text-ps-body-light">{body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-full border border-ps-ash px-6 text-[14px] font-bold tracking-[0.3px] text-ps-ink transition-colors active:bg-ps-soft"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-11 items-center rounded-full bg-ps-warning px-6 text-[14px] font-bold tracking-[0.3px] text-white transition-colors active:bg-[#a5162f] disabled:opacity-60"
          >
            {busy ? "删除中…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
