// npm run demo: デモ用の偽 Supabase と Next.js の開発サーバーを一緒に起動する（本番の Supabase が無くても画面を見られる）
// 同じ Wi-Fi のスマホからも開けるよう、PC の LAN の IP アドレスで待ち受ける
import { spawn } from "node:child_process";
import os from "node:os";
import { DEMO_PORT, startDemoSupabase } from "./demo-supabase.mjs";

// 仮想アダプタ（WSL・Hyper-V・Docker など）は避ける。うまく選ばれないときは DEMO_HOST=192.168.x.x で指定する
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|Loopback|Tailscale|ZeroTier/i;
const lanAddress = process.env.DEMO_HOST || Object.entries(os.networkInterfaces())
  .filter(([name]) => !VIRTUAL.test(name))
  .flatMap(([, addresses]) => addresses ?? [])
  .find((a) => a.family === "IPv4" && !a.internal)?.address;
const host = lanAddress ?? "localhost";

startDemoSupabase();
console.log(`デモ用 Supabase: http://${host}:${DEMO_PORT}（データはメモリだけ。止めると消えます）`);
console.log("管理画面: http://localhost:3000");
if (lanAddress) console.log(`スマホ（同じ Wi-Fi）: http://${lanAddress}:3000  ※初回は Windows のファイアウォールで node の通信を許可してください`);
console.log("「Googleでログイン」からロールを選んで入ります\n");

const next = spawn("npx", ["next", "dev", "--hostname", "0.0.0.0", "--port", "3000"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://${host}:${DEMO_PORT}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "demo-anon-key",
    DEMO_LAN_HOST: lanAddress ?? "" },
});
next.on("exit", (code) => process.exit(code ?? 0));
