import type { NextConfig } from "next";

// 静的出力して Cloudflare Pages で配信する（ADR-0002）。動的ルート・Server Actions は使わない
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactCompiler: true,
  // npm run demo で、同じ Wi-Fi のスマホから開発サーバーを開けるようにする（開発時だけ効く）
  allowedDevOrigins: process.env.DEMO_LAN_HOST ? [process.env.DEMO_LAN_HOST] : [],
  // 開発用の表示（N）が画面下の操作バーに重ならないように
  devIndicators: { position: "top-right" },
};

export default nextConfig;
