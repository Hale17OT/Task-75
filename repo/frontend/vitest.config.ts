import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "postcss.config.cjs",
        "tailwind.config.ts",
        "vite.config.ts",
        "vitest.config.ts",
        "src/main.ts",
        "src/App.vue",
        "src/types.ts"
      ],
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90
      }
    }
  }
});
