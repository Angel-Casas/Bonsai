import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Zero retries for determinism - tests should be stable
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  // Output both HTML and JSON reports (JSON for skip detection)
  reporter: process.env.CI
    ? [['html'], ['json', { outputFile: 'test-results.json' }]]
    : 'html',
  use: {
    baseURL: 'http://localhost:5180',
    // Capture traces, screenshots, and video on failure for debugging
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5180',
    url: 'http://localhost:5180',
    reuseExistingServer: !process.env.CI,
  },
})
