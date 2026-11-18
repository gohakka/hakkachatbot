import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "共下講 · 客語語音夥伴",
  description: "用客語，講你想講的。大顆麥克風、即時對話字幕，陪你聊聊日常。",
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
