import { defineConfig, devices } from '@playwright/test';

/**
 * Uçtan uca (E2E) testler — gerçek tarayıcıda oynanış akışları.
 * Yalnızca MİSAFİR/çevrimdışı akışları test eder (backend gerekmez): oyna,
 * mod değiştir, tahta boyutu, dil değiştir. Böylece CI'da dış bağımlılık yok.
 * Uygulama `ng serve` ile ayağa kalkar; Playwright hazır olmasını bekler.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
