import { defineConfig } from "@playwright/test";
import baseConfig from "../playwright.config";

export default defineConfig({
  ...baseConfig,
  testDir: "../tests/e2e",
  use: {
    ...baseConfig.use,
    video: "on"
  },
  outputDir: "../test-results/video-run"
});
