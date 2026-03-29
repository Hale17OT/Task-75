import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      exclude: [
        "src/server.ts",
        "src/logger.ts",
        "src/database.ts",
        "src/request-context.ts",
        "src/schema.ts",
        "src/service-types.ts",
        "src/types.ts",
        "src/services/service-type-helpers.ts",
        "src/services/service-utility-types.ts",
        "tests/test-helpers.ts",
        "vitest.config.ts"
      ],
      reporter: ["text", "html"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 75,
        statements: 90
      }
    }
  }
});
