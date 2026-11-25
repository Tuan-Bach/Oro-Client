import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  root: "./src/renderer",
  publicDir: "./public",
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor-react";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }
          if (id.includes("node_modules/marked")) {
            return "vendor-markdown";
          }
          if (id.includes("node_modules/@monaco-editor")) {
            return "vendor-monaco";
          }
          if (id.includes("node_modules/three")) {
            return "vendor-three";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
