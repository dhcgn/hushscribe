import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE = '/hushscribe/';

export default defineConfig({
  testDir: './test/e2e',
  // @smoke hits the real enclave: it needs a key and costs money. Opt in with
  // `npm run test:smoke`. Never let the default suite spend credit.
  grepInvert: /@smoke/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : [['list']],

  use: {
    // Tests hit the real production bundle through `vite preview`, at the same
    // base path Pages serves — that is where "works locally, blank on Pages"
    // bugs surface (ARCHITECTURE.md §8.1).
    baseURL: `http://localhost:${PORT}${BASE}`,
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run build && npm run preview',
    url: `http://localhost:${PORT}${BASE}`,
    // Never reuse: `preview` serves dist/, so an already-running server would
    // silently test a stale bundle and skip the rebuild entirely — which defeats
    // the point of testing the artifact that actually deploys. The build is ~2s.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
