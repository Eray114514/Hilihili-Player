"use client";

import { Bell, Bookmark, CheckCircle2, ChevronRight, Clapperboard, Coins, Heart, History, Home, Library, Play, Radio, Search, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { SearchHistoryItem } from "@hilihili/shared";
import { clearSearchHistory, deleteSearchHistory, getJson, getSearchHistory } from "@/lib/api";

const navItems = [
  { href: "/", label: "首页", icon: Home },
  { href: "/dynamic", label: "动态", icon: Radio },
  { href: "/messages", label: "消息", icon: Bell },
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
            {navItems.filter((item) => item.href !== "/messages").map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return <Link key={item.href} href={item.href} className={`nav-link ${active ? "active" : ""}`}>{item.label}</Link>;
            })}
          </nav>
          <div className="order-3 w-full md:order-none md:ml-auto md:max-w-xl">
            <Suspense fallback={<HeaderSearchFallback />}><HeaderSearch /></Suspense>
          </div>
          <MessageButton />
          <div className="ml-auto md:ml-0"><ProfileMenu /></div>
        </div>
      </header>

      <main className={`mx-auto min-h-[calc(100vh-4.25rem)] px-4 pb-24 pt-6 md:px-6 md:pb-12 ${wide ? "max-w-[1760px]" : "max-w-[1600px]"}`}>{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/8 bg-[#0d0f14]/96 px-4 py-2 backdrop-blur md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`relative flex flex-col items-center gap-1 text-[11px] ${active ? "text-[var(--accent)]" : "text-white/45"}`}>
              {active && (
                <motion.div
                  layoutId="bottom-nav-indicator"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  className="absolute top-0 left-0 right-0 mx-auto h-1 w-8 rounded-full bg-[var(--accent)]"
                />
              )}
              <Icon size={19} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function HeaderSearch() {
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const [focused, setFocused] = useState(false);
  const [items, setItems] = useState<SearchHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldShowPanel = focused && value.trim() === "";

  // Fetch history the first time the panel opens.
  useEffect(() => {
    if (!shouldShowPanel || loaded) return;
    let disposed = false;
    setLoading(true);
    getSearchHistory()
      .then((data) => { if (!disposed) setItems(data.items); })
      .catch(() => { if (!disposed) setItems([]); })
      .finally(() => { if (!disposed) { setLoading(false); setLoaded(true); } });
    return () => { disposed = true; };
  }, [shouldShowPanel, loaded]);

  // Clear any pending blur timeout on unmount.
  useEffect(() => () => { if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current); }, []);

  const handleFocus = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setFocused(true);
  };

  const handleBlur = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    // Delayed close so clicks on history items register before the panel disappears.
    blurTimeoutRef.current = setTimeout(() => setFocused(false), 150);
  };

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    void deleteSearchHistory(id).catch(() => {});
  };

  const handleClear = () => {
    setItems([]);
    void clearSearchHistory().catch(() => {});
  };

  return (
    <form action="/search" className="group relative" autoComplete="off">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/38 transition group-focus-within:text-[var(--accent)]" size={18} />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder="搜索视频、UP 主、分区或标签"
        aria-label="搜索媒体库"
        aria-expanded={shouldShowPanel}
        aria-controls="header-search-history"
        autoComplete="off"
        className="h-10 w-full rounded-xl border border-white/9 bg-white/[0.055] pl-10 pr-20 text-sm text-white outline-none transition placeholder:text-white/30 hover:bg-white/[0.075] focus:border-[rgba(94,234,212,.42)] focus:bg-[#161b20] focus:shadow-[0_0_0_3px_rgba(94,234,212,.08)]"
      />
      <button type="submit" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-white/8 px-2.5 py-1.5 text-xs text-white/55 transition hover:bg-white/14 hover:text-white">搜索</button>
      <AnimatePresence>
        {shouldShowPanel && (
          <motion.div
            id="header-search-history"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-2xl border border-white/10 bg-[#171920] p-2 shadow-2xl shadow-black/50"
          >
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-xs font-medium text-white/45">最近搜索</span>
              {items.length > 0 && (
                <button type="button" onClick={handleClear} className="text-xs text-white/45 transition hover:text-white">清空历史</button>
              )}
            </div>
            {loading ? (
              <div className="px-3 py-3 text-sm text-white/45">加载中…</div>
            ) : items.length === 0 ? (
              <div className="px-3 py-3 text-sm text-white/35">暂无搜索历史</div>
            ) : (
              <ul className="max-h-80 overflow-y-auto">
                <AnimatePresence initial={false}>
                  {items.map((item) => (
                    <motion.li
                      key={item.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.15 }}
                      className="group/row flex items-center overflow-hidden rounded-lg hover:bg-white/6"
                    >
                      <Link
                        href={`/search?q=${encodeURIComponent(item.query)}`}
                        className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 text-sm text-white/70 hover:text-white"
                      >
                        {item.query}
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        className="mr-2 text-white/40 opacity-0 transition hover:text-white focus-visible:opacity-100 group-hover/row:opacity-100"
                        aria-label={`删除搜索历史 ${item.query}`}
                      >
                        <X size={14} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}

function HeaderSearchFallback() {
  return <div className="h-10 w-full skeleton-shimmer rounded-xl bg-white/[0.055]" />;
}

function MessageButton() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let disposed = false;
    const refresh = () => { void getJson<{ unreadCount: number }>("/me/messages/unread-count").then((data) => { if (!disposed) setUnread(data.unreadCount); }).catch(() => {}); };
    refresh();
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { disposed = true; window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, []);
  return <Link href="/messages" className="relative grid h-10 w-10 place-items-center rounded-xl text-white/55 transition hover:bg-white/7 hover:text-white" aria-label={unread > 0 ? `视频消息，${unread} 条未读` : "视频消息"}><Bell size={19} />{unread > 0 ? <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold leading-5 text-black">{unread > 99 ? "99+" : unread}</span> : null}</Link>;
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Track the latest pointer type so we can ignore synthesized mouse events on touch devices.
  const lastPointerType = useRef<PointerEvent["pointerType"]>("mouse");

  const menuItems = [
    { href: "/history", label: "继续观看", icon: Play },
    { href: "/history?tab=history", label: "观看历史", icon: History },
    { href: "/history?tab=completed", label: "已看完", icon: CheckCircle2 },
    { href: "/history?tab=likes", label: "最近点赞", icon: Heart },
    { href: "/history?tab=coins", label: "最近投币", icon: Coins },
    { href: "/favorites", label: "我的收藏", icon: Bookmark },
    { href: "/messages", label: "视频消息", icon: Bell },
    { href: "/settings", label: "设置与媒体库", icon: Settings }
  ];

  // Close on outside pointerdown while open.
  useEffect(() => {
    if (!open) return;
    const handler = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  const handlePointerDown = (event: React.PointerEvent) => {
    lastPointerType.current = event.pointerType;
  };

  const handleMouseEnter = () => {
    // Ignore synthesized mouse events on touch devices.
    if (lastPointerType.current !== "mouse") return;
    setHovering(true);
    setOpen(true);
  };

  const handleMouseLeave = () => {
    if (lastPointerType.current !== "mouse") return;
    setHovering(false);
    setOpen(false);
  };

  const handleFocus = () => setOpen(true);

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    // Only close if focus is leaving the container entirely.
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setOpen(false);
    }
  };

  const handleAvatarClick = () => {
    // On desktop, hover already opened the menu — don't toggle-close on click.
    if (hovering) return;
    setOpen((prev) => !prev);
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onPointerDown={handlePointerDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <button
        type="button"
        onClick={handleAvatarClick}
        aria-label="打开个人菜单"
        aria-expanded={open}
        className="grid h-10 w-10 place-items-center rounded-full outline-none ring-offset-2 ring-offset-[#0d0f14] transition hover:ring-1 hover:ring-white/20 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[linear-gradient(145deg,#87f5df_0%,#36bfa9_52%,#6957d9_100%)] font-black text-[#07110f] shadow-lg shadow-teal-950/30 ring-1 ring-white/15">
          H
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#171920] p-2 shadow-2xl shadow-black/50"
          >
            <div className="mb-2 rounded-xl bg-[linear-gradient(135deg,rgba(94,234,212,.14),rgba(105,87,217,.12))] p-3">
              <div className="font-semibold">本地观众 H</div>
              <p className="mt-1 text-xs leading-5 text-white/45">一只住在局域网里的小电视，替你记住看到哪一 P。</p>
            </div>
            {menuItems.map((item) => {
              const Icon = item.icon;
              return <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/68 transition hover:bg-white/7 hover:text-white"><Icon size={17} /><span>{item.label}</span><ChevronRight className="ml-auto text-white/25" size={15} /></Link>;
            })}
          </motion.div>
        )}
      </AnimatePresence>
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
