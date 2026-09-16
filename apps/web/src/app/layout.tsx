import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { requestPublicBase } from "@/lib/server-api";
import { setServerRenderedApiBase } from "@/lib/api-base";

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

// 这里刻意不做任何数据获取。
//
// 原来 RootLayout 会 await 一次 /categories（只为了给首页的分类栏预热 SWR fallback），
// 结果是每个页面的 HTML 首字节都被一次 API 往返挡住——在异地组网的高 RTT 链路下
// 这是实打实的首屏延迟。现在需要的页面各自在 Server Component 里取，
// 并用 Suspense 包住，页面骨架先出、数据后到。
//
// 唯一要做的是把「浏览器可达的 API 基地址」告诉 assetUrl：
// 否则 SSR 出来的封面地址会是容器内网地址（http://api:4141），首屏全是裂图。
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  setServerRenderedApiBase(await requestPublicBase());
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full antialiased"><Providers>{children}</Providers></body>
    </html>
  );
}