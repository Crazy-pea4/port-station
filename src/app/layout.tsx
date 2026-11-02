import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full bg-ps-canvas-light">{children}</body>
    </html>
  );
}
