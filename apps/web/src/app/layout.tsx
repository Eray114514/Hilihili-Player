import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import type { Category } from "@/lib/api";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Hilihili Player",
  description: "A private LAN video library and recommendation app",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    title: "Hilihili"
  }
};

// 服务端预取 categories：5 分钟 ISR 缓存，失败时返回 null（首屏回退到客户端 useApi 兜底）。
// 注意：不能 value-import @/lib/api —— 该模块 import 了客户端 useSWR，而 swr 的 react-server 入口
// 没有 default 导出，把 lib/api.ts 拉进 RSC 构建图会报错。故这里内联服务端 API base 解析
// （与 getApiBase 的服务端分支一致），Category 仅用 import type（类型导入被擦除，不进运行时图）。
async function fetchCategories(): Promise<{ categories: Category[] } | null> {
  try {
    const base = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4141";
    const res = await fetch(`${base}/categories`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const categoriesData = await fetchCategories();
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full antialiased"><Providers fallback={categoriesData ? { "/categories": categoriesData } : undefined}>{children}</Providers></body>
    </html>
  );
}
