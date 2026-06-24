"use client";

import { CheckCircle2, ChevronRight, Clapperboard, Heart, History, Home, Library, Play, Radio, Settings } from "lucide-react";
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
          <div className="ml-auto"><ProfileMenu /></div>
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

function ProfileMenu() {
  const menuItems = [
    { href: "/history", label: "继续观看", icon: Play },
    { href: "/history?tab=history", label: "观看历史", icon: History },
    { href: "/history?tab=completed", label: "已看完", icon: CheckCircle2 },
    { href: "/history?tab=likes", label: "最近点赞", icon: Heart },
    { href: "/settings", label: "设置与媒体库", icon: Settings }
  ];
  return (
    <details className="group/profile relative">
      <summary className="list-none rounded-full outline-none ring-offset-2 ring-offset-[#0d0f14] focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label="打开个人菜单">
        <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[linear-gradient(145deg,#87f5df_0%,#36bfa9_48%,#6957d9_100%)] font-black text-[#07110f] shadow-lg shadow-teal-950/30 ring-2 ring-white/15">
          H
          <span className="absolute bottom-0.5 right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#0d0f14] text-[var(--accent)] ring-1 ring-white/20"><Play size={7} fill="currentColor" /></span>
        </span>
      </summary>
      <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#171920] p-2 shadow-2xl shadow-black/50">
        <div className="mb-2 rounded-xl bg-[linear-gradient(135deg,rgba(94,234,212,.14),rgba(105,87,217,.12))] p-3">
          <div className="font-semibold">本地观众 H</div>
          <p className="mt-1 text-xs leading-5 text-white/45">一只住在局域网里的小电视，替你记住看到哪一 P。</p>
        </div>
        {menuItems.map((item) => {
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/68 transition hover:bg-white/7 hover:text-white"><Icon size={17} /><span>{item.label}</span><ChevronRight className="ml-auto text-white/25" size={15} /></Link>;
        })}
      </div>
    </details>
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
