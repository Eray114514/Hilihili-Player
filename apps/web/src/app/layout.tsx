import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 全站强制动态渲染。
//
// 所有页面都是个性化数据（观看进度、推荐流、未读数），没有可静态化的内容；
// 更关键的是：不声明这项时，Next 会在首次请求时尝试把页面静态预渲染，
// 期间带 cache:"no-store" 的 fetch 抛出的 DynamicServerError 若被下游 try/catch
// 吞掉，「空数据骨架」就会被固化成静态页——数据永远不会出现。
// force-dynamic 让路由跳过静态化尝试，serverGet 的网络失败兜底（返回 null +
// 客户端 SWR 重试）只处理真正的网络问题。
export const dynamic = "force-dynamic";

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

// 这里刻意不做任何数据获取。
//
// 原来 RootLayout 会 await 一次 /categories（只为了给首页的分类栏预热 SWR fallback），
// 结果是每个页面的 HTML 首字节都被一次 API 往返挡住——在异地组网的高 RTT 链路下
// 这是实打实的首屏延迟。现在需要的页面各自在 Server Component 里取，
// 并用 Suspense 包住，页面骨架先出、数据后到。
//
// 浏览器可达的 API 地址由 getApiBase() 的生产分支以同源相对前缀（/api）解决，
// 由反向代理按路径分流（见 Caddyfile），无需按请求推导 host。
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full antialiased"><Providers>{children}</Providers></body>
    </html>
  );
}