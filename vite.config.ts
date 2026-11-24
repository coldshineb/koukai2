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
  },
});
