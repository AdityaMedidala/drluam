import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the FastAPI server so the frontend always calls a relative /api.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": process.env.API_URL ?? "http://localhost:8000" } },
  // spike.html is the chart-library spike (not linked from the app); remove after the decision.
  build: { rollupOptions: { input: { main: "index.html", spike: "spike.html" } } },
});
