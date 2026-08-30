import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

/**
 * The opt-in suite that talks to a real enclave: `npm run test:smoke`.
 *
 * It lives in its own config so the default `playwright test` can exclude
 * @smoke outright. Presence of a key is not enough to opt in — running these
 * costs real credit, and a developer with a working .env should not have
 * `npm test` quietly spend it.
 */
export default defineConfig({
  ...base,
  grep: /@smoke/,
  grepInvert: undefined,
  // Real transcription of a real speech is minutes, not milliseconds.
  timeout: 300_000,
  retries: 0,
  workers: 1,
});
