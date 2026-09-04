import type { Metadata, Viewport } from "next";
import { Inter, Roboto } from "next/font/google";
import "./globals.css";

// DESIGN.md 字体替代方案：Roboto Light(300) 对应 SST 展示层级，Inter 对应正文
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Port Station · 服务控制台",
  description: "自动发现本机正在监听的端口，一键打开或关闭。",
  other: {
    // 禁止 Dark Reader 等插件改写本站配色
    "darkreader-lock": "true",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className={`${roboto.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-ps-canvas-light">{children}</body>
    </html>
  );
}
