import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const runtimeEnv =
  (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env || {};
const webPort = Number(runtimeEnv.VITE_PORT || 5174);
const apiTarget = runtimeEnv.VITE_API_TARGET || "http://127.0.0.1:5175";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false
      }
    }
  },
  build: {
    sourcemap: false,
    target: "es2022"
  }
});
