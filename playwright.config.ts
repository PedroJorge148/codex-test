import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/e2e', timeout: 60000, expect: { timeout: 15000 }, workers: 1, fullyParallel: false, reporter: 'list', use: { baseURL: 'http://localhost:3000', browserName: 'chromium', channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'off' } });
