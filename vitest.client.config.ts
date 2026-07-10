import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Client component tests: React components rendered in jsdom via Testing Library.
// No Tailwind/Cloudflare plugins needed — class names are inert strings in tests.
export default defineConfig({
  plugins: [react()],
  test: {
    name: "client",
    environment: "jsdom",
    globals: true,
    include: ["test/client/**/*.test.tsx"],
    setupFiles: ["test/client/setup.ts"],
  },
});
