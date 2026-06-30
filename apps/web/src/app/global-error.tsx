"use client";

import { AlertCircle, RefreshCw } from "lucide-react";
import "./globals.css";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-full antialiased">
        <div className="grid min-h-screen place-items-center bg-[var(--background)] p-6 text-[var(--foreground)]">
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-white/28">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-lg font-semibold">出了点问题</h2>
            <p className="mt-2 text-sm text-white/42">{error.message}</p>
            <button type="button" className="primary-button mt-5" onClick={reset}>
              <RefreshCw size={15} /> 重试
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
