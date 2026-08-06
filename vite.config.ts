import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// المعاينة على GitHub Pages تُقدَّم من ‎/<repo>/‎ لا من الجذر. المسار يأتي من
// البيئة وقت البناء ليبقى التطوير المحلي على الجذر بلا تكوين إضافي.
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { host: "0.0.0.0", port: 5173 },
});
