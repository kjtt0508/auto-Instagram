import type { NextConfig } from "next";

// 静的出力して Cloudflare Pages で配信する（ADR-0002）。動的ルート・Server Actions は使わない
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactCompiler: true,
};

export default nextConfig;
