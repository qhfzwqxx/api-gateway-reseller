import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./front/front-theme.css";

export const metadata: Metadata = {
  title: "APIshare",
  description: "APIshare account, wallet, usage, and billing dashboard.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-screen overflow-hidden">
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
