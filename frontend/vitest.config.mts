import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // ドメインは DOM 不要。画面のテストはファイル先頭の `// @vitest-environment jsdom` で切り替える
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
