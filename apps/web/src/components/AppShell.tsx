"use client";

import { Clapperboard, Compass, Home, Library, Radio, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/dynamic", label: "动态", icon: Radio },
  { href: "/settings", label: "设置", icon: Settings }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-20 border-r border-white/8 bg-[#101116]/95 backdrop-blur lg:block">
        <Link href="/" className="flex h-16 items-center justify-center text-[var(--accent)]" aria-label="Hilihili">
          <Clapperboard size={28} />
        </Link>
        <nav className="mt-4 flex flex-col items-center gap-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`grid h-12 w-12 place-items-center rounded-lg transition ${
                  active ? "bg-white text-black" : "text-white/62 hover:bg-white/8 hover:text-white"
                }`}
              >
                <Icon size={21} />
              </Link>
            );
          })}
        </nav>
      </aside>

      <header className="sticky top-0 z-30 border-b border-white/8 bg-[#101116]/88 backdrop-blur lg:left-20">
        <div className="mx-auto flex h-16 max-w-[1760px] items-center gap-4 px-4 lg:pl-28 lg:pr-8">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold lg:hidden">
            <Clapperboard className="text-[var(--accent)]" size={24} />
            Hilihili
          </Link>
          <div className="hidden items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/55 md:flex">
            <Compass size={16} />
            局域网私人视频站
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/settings" className="hidden rounded-lg bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/86 md:block">
              添加媒体库
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-[1760px] px-4 pb-24 pt-6 lg:pl-28 lg:pr-8">
        {children}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t border-white/8 bg-[#101116]/95 px-4 py-2 backdrop-blur lg:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-1 text-xs ${active ? "text-white" : "text-white/48"}`}>
              <Icon size={20} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-white/12 bg-white/[0.025] p-8 text-center">
      <Library className="mb-4 text-white/35" size={36} />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-white/55">{body}</p>
      <Link href="/settings" className="mt-6 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-black">
        去添加视频库
      </Link>
    </div>
  );
}
