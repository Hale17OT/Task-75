import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../temp",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    video: "on"
  },
  outputDir: "../test-results/video-run-smoke"
});
