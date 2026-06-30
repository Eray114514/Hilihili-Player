"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

type ErrorFallbackProps = {
  error?: Error & { digest?: string };
  reset: () => void;
  title?: string;
  body?: string;
};

export function ErrorFallback({ error, reset, title = "出了点问题", body }: ErrorFallbackProps) {
  const message = body ?? error?.message ?? "发生了未知错误";
  return (
    <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center">
      <div>
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-white/28">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-white/42">{message}</p>
        <button type="button" className="primary-button mt-5" onClick={reset}>
          <RefreshCw size={15} /> 重试
        </button>
      </div>
    </div>
  );
}
