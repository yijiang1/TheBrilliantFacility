const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: '**/*.spec.js', workers: 1, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:3000', headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm start', url: 'http://127.0.0.1:3000/health', reuseExistingServer: !process.env.CI },
});
