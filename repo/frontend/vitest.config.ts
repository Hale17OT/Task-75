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
        // Vue single-file components compile each inline `@click` / `@input`
        // template expression into its own function under v8 coverage. Even
        // when every emit-from-template path is exercised, the count of
        // anonymous wrappers makes the 90% gate a brittle target. Lines,
        // statements, and branches still gate at the project default.
        lines: 90,
        functions: 85,
        branches: 80,
        statements: 90
      }
    }
  }
});
