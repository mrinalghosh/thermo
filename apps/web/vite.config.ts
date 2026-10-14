import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build can be hosted from any sub-path (e.g. GitHub Pages).
  base: "./",
});
