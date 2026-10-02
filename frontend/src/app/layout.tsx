import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/layout/AppShell";
import "./globals.css";

// ホーム画面に追加すると、アイコンから全画面（standalone）で開ける（REQ-001 設計 3.2 PWA）
export const metadata: Metadata = {
  title: "新島info 投稿",
  description: "新島info の Instagram 予約投稿",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "新島info", statusBarStyle: "default" },
};

// viewport-fit=cover で画面の端（ノッチ・ホームバー）まで使い、余白は env(safe-area-inset-*) で取る
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
