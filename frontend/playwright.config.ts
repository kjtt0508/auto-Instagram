import { defineConfig, devices } from "@playwright/test";

// E2E: 静的出力（out/）をそのまま配信し、Supabase への通信は e2e/supabaseMock.ts で差し替える。スマホ幅（375px）で確かめる
const PORT = 4173;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${PORT}`, ...devices["iPhone SE"], browserName: "chromium", viewport: { width: 375, height: 667 } },
  webServer: {
    command: `npx next build && npx serve out -l ${PORT} --no-clipboard`,
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://e2e.supabase.test", NEXT_PUBLIC_SUPABASE_ANON_KEY: "e2e-anon-key" },
  },
});
