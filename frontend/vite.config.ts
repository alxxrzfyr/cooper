import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, resolve(process.cwd(), ".."), "");
  const localKey = rootEnv.COOPER_SHARED_KEY?.trim();
  const proxyHeaders = localKey ? { "X-Cooper-Key": localKey } : {};

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          headers: proxyHeaders,
        },
        "/health": {
          target: "http://127.0.0.1:8000",
          headers: proxyHeaders,
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      env: {
        TZ: "Asia/Singapore",
      },
    },
  };
});
