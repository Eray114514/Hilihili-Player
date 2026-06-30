import { FileQuestion } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function NotFound() {
  return (
    <AppShell>
      <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center">
        <div>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-white/28">
            <FileQuestion size={32} />
          </div>
          <h2 className="text-lg font-semibold">页面不存在</h2>
          <p className="mt-2 text-sm text-white/42">链接可能失效了，回首页看看吧</p>
          <Link href="/" className="primary-button mt-5">回首页</Link>
        </div>
      </div>
    </AppShell>
  );
}
