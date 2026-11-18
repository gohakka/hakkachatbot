import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "哈妮 Hani · 打一通客語電話",
  description: "想講的話，打給哈妮。你的客語聊天夥伴，支援即時對話字幕。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
