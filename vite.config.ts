import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    // 브라우저 개발(모의 모드) 전용 — Quotation API CORS 회피 프록시.
    // 실거래(Exchange)는 Tauri Rust 커맨드로만 호출한다 (docs/upbit-api-implementation-notes.md)
    proxy: {
      "/upbit-api": {
        target: "https://api.upbit.com",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/upbit-api/, ""),
      },
    },
  },
}));
