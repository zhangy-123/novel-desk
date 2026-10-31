import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 前端构建配置
// https://v2.tauri.app/reference/config/
export default defineConfig({
  plugins: [react()],
  // Tauri 要求固定端口且禁止浏览器自动打开
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
  },
});
