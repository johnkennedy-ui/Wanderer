import { defineConfig } from "@playwright/test";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const previewPath = process.env.PLAYWRIGHT_BASE_PATH ?? "/";
const previewPort = process.env.PLAYWRIGHT_PORT ?? "4173";
const previewUrl = new URL(
  previewPath,
  `http://127.0.0.1:${previewPort}`,
).toString();

export default defineConfig({
  testDir: "./src/tests/browser",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: previewUrl,
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    launchOptions:
      chromiumExecutable === undefined
        ? undefined
        : { executablePath: chromiumExecutable },
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
      },
    },
    {
      // A mobile-sized browser context exercises responsive touch/pointer UI;
      // it is intentionally browser evidence, not iOS/Android device evidence.
      name: "touch",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
