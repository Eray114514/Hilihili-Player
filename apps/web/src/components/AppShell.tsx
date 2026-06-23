"use client";

import { Clapperboard, Home, Library, Radio, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/dynamic", label: "动态", icon: Radio },
  { href: "/settings", label: "媒体库", icon: Settings }
];

export function AppShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-[#0d0f14]/88 backdrop-blur-xl">
        <div className={`mx-auto flex h-15 items-center gap-6 px-4 md:px-6 ${wide ? "max-w-[1760px]" : "max-w-[1600px]"}`}>
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--accent)] text-[#07110f]"><Clapperboard size={19} /></span>
            <span>Hilihili</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return <Link key={item.href} href={item.href} className={`nav-link ${active ? "active" : ""}`}>{item.label}</Link>;
            })}
          </nav>
          <div className="ml-auto">
            <Link href="/settings" className="secondary-button max-sm:!hidden"><Library size={16} /> 添加媒体库</Link>
          </div>
        </div>
      </header>

      <main className={`mx-auto min-h-[calc(100vh-3.75rem)] px-4 pb-24 pt-6 md:px-6 md:pb-12 ${wide ? "max-w-[1760px]" : "max-w-[1600px]"}`}>{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-white/8 bg-[#0d0f14]/96 px-4 py-2 backdrop-blur md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 text-[11px] ${active ? "text-[var(--accent)]" : "text-white/45"}`}><Icon size={19} />{item.label}</Link>;
        })}
      </nav>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-white/12 bg-white/[0.02] p-8 text-center">
      <Library className="mb-4 text-white/30" size={36} />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-white/50">{body}</p>
      <Link href="/settings" className="primary-button mt-6">去添加视频库</Link>
    </div>
  );
}
