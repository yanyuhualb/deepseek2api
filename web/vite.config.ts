import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "../public-dist",
    emptyDir: true,
    sourcemap: false,
    target: "es2022",
    chunkSizeWarningLimit: 1200
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/proxy": "http://127.0.0.1:3000",
      "/v1": "http://127.0.0.1:3000"
    }
  }
});
