"use client";

import { Bookmark, CheckCircle2, ChevronRight, Clapperboard, Coins, Heart, History, Home, Library, Play, Radio, Search, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";

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
        <div className={`mx-auto flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 md:h-17 md:flex-nowrap md:px-6 md:py-0 ${wide ? "max-w-[1760px]" : "max-w-[1600px]"}`}>
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[linear-gradient(145deg,#8af7e4,#49d6c0)] text-[#07110f] shadow-[0_0_24px_rgba(94,234,212,.18)]"><Clapperboard size={19} /></span>
            <span>Hilihili</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return <Link key={item.href} href={item.href} className={`nav-link ${active ? "active" : ""}`}>{item.label}</Link>;
            })}
          </nav>
          <div className="order-3 w-full md:order-none md:ml-auto md:max-w-xl">
            <Suspense fallback={<HeaderSearchFallback />}><HeaderSearch /></Suspense>
          </div>
          <div className="ml-auto md:ml-0"><ProfileMenu /></div>
        </div>
      </header>

      <main className={`mx-auto min-h-[calc(100vh-4.25rem)] px-4 pb-24 pt-6 md:px-6 md:pb-12 ${wide ? "max-w-[1760px]" : "max-w-[1600px]"}`}>{children}</main>

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

function HeaderSearch() {
  const searchParams = useSearchParams();
  return (
    <form action="/search" className="group relative">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/38 transition group-focus-within:text-[var(--accent)]" size={18} />
      <input
        type="search"
        name="q"
        defaultValue={searchParams.get("q") ?? ""}
        placeholder="搜索视频、UP 主、分区或标签"
        aria-label="搜索媒体库"
        className="h-10 w-full rounded-xl border border-white/9 bg-white/[0.055] pl-10 pr-20 text-sm text-white outline-none transition placeholder:text-white/30 hover:bg-white/[0.075] focus:border-[rgba(94,234,212,.42)] focus:bg-[#161b20] focus:shadow-[0_0_0_3px_rgba(94,234,212,.08)]"
      />
      <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-white/8 px-2.5 py-1.5 text-xs text-white/55 transition hover:bg-white/14 hover:text-white">搜索</button>
    </form>
  );
}

function HeaderSearchFallback() {
  return <div className="h-10 w-full animate-pulse rounded-xl bg-white/[0.055]" />;
}

function ProfileMenu() {
  const menuItems = [
    { href: "/history", label: "继续观看", icon: Play },
    { href: "/history?tab=history", label: "观看历史", icon: History },
    { href: "/history?tab=completed", label: "已看完", icon: CheckCircle2 },
    { href: "/history?tab=likes", label: "最近点赞", icon: Heart },
    { href: "/history?tab=coins", label: "最近投币", icon: Coins },
    { href: "/favorites", label: "我的收藏", icon: Bookmark },
    { href: "/settings", label: "设置与媒体库", icon: Settings }
  ];
  return (
    <details className="group/profile relative">
      <summary className="grid h-10 w-10 place-items-center rounded-full outline-none ring-offset-2 ring-offset-[#0d0f14] transition hover:ring-1 hover:ring-white/20 focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label="打开个人菜单">
        <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[linear-gradient(145deg,#87f5df_0%,#36bfa9_52%,#6957d9_100%)] font-black text-[#07110f] shadow-lg shadow-teal-950/30 ring-1 ring-white/15">
          H
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
