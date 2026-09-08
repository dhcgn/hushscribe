import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The opt-in suite that talks to a real enclave: `npm run test:smoke`.
 *
 * It lives in its own config so the default `playwright test` can exclude
 * @smoke outright. Presence of a key is not enough to opt in — running these
 * costs real credit, and a developer with a working .env should not have
 * `npm test` quietly spend it.
 */
// Drop the exclusion rather than overwrite it with undefined: under
// exactOptionalPropertyTypes an explicit undefined is not "absent".
const { grepInvert: _excluded, ...rest } = base;

export default defineConfig({
  ...rest,
  grep: /@smoke/,
  // Real transcription of a real speech is minutes, not milliseconds.
  timeout: 300_000,
  retries: 0,
  workers: 1,
});
