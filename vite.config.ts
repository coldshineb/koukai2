import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: false,
  server: {
    port: 8080,
    open: false,
  },
  build: {
    target: "es2022",
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/src/game/opening.js") || id.includes("/src/game/ending")) return "cinematics";
          if (id.includes("/src/scenes/")) return "scenes";
        },
      },
    },
  },
});
