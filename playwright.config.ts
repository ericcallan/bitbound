import { defineConfig } from '@playwright/test';

/**
 * Browser tests. Headless Chromium on macOS renders WebGL2 through ANGLE/Metal on the real GPU, so these run the
 * actual shaders. Uses the dev server (scenarios are dev-only); an already-running one on PIP_URL is reused.
 */
const url = process.env.PIP_URL ?? 'http://localhost:5180';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 2,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.04, threshold: 0.25 } },
  use: {
    baseURL: url,
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: `npx vite --port ${new URL(url).port} --strictPort`,
    url,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
