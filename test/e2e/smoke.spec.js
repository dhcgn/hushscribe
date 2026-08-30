import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

/**
 * The only tests that touch a real enclave. They need a real key and real money,
 * so they are opt-in: set PRIVATEMODE_AI_API_KEY (from .env, or a repository
 * secret on a scheduled run) and they run; otherwise they skip.
 *
 * Never wire these into pull-request CI — fork PRs cannot read secrets, and
 * every run costs credit.
 *
 *   npm run test:smoke
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'test-data');

function apiKey() {
  if (process.env.PRIVATEMODE_AI_API_KEY) return process.env.PRIVATEMODE_AI_API_KEY;
  const env = join(HERE, '..', '..', '.env');
  if (!existsSync(env)) return '';
  return (readFileSync(env, 'utf8').match(/^PRIVATEMODE_AI_API_KEY=(.*)$/m)?.[1] ?? '').trim();
}

const KEY = apiKey();
const media = (name) => join(DATA, name);

test.describe('@smoke real enclave', () => {
  test.skip(!KEY, 'no PRIVATEMODE_AI_API_KEY — smoke tests are opt-in');
  test.skip(!existsSync(DATA), 'test-data/ is not present');
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('attests against the live deployment', async ({ page }) => {
    await page.goto('.');
    await page.getByLabel('Privatemode API key').fill(KEY);
    await page.getByRole('button', { name: 'Verify & save' }).click();

    // No fake here: this exercises the real Wasm verifier, the pinned hash, the
    // manifest fetch from cdn.confidential.cloud, and the HPKE handshake.
    await expect(page.locator('#chip')).toHaveText('sealed', { timeout: 120_000 });
    await page.locator('#proof summary').click();
    await expect(page.locator('#digest')).toContainText(/^sha256:[0-9a-f]{64}$/);
  });

  test('transcribes English with timestamps', async ({ page }) => {
    test.skip(!existsSync(media('eng_jfkinaugural2.mp3')), 'fixture missing');
    await page.goto('.');
    await page.getByLabel('Privatemode API key').fill(KEY);
    await page.getByRole('button', { name: 'Verify & save' }).click();
    await expect(page.locator('#chip')).toHaveText('sealed', { timeout: 120_000 });

    await page.getByLabel('Spoken language').selectOption('en');
    await page.getByLabel(/Names and spellings/).fill(
      readFileSync(media('eng_jfkinaugural2.prompt.txt'), 'utf8').trim(),
    );
    await page.locator('#picker').setInputFiles(media('eng_jfkinaugural2.mp3'));

    const card = page.locator('.card').first();
    await expect(card.locator('.seg').first()).toBeVisible({ timeout: 240_000 });
    // The speech's most quoted line — a cheap check that this is a real transcript.
    await expect(card).toContainText(/ask not/i);
  });

  test('transcribes German', async ({ page }) => {
    const file = 'de_Wie reagieren Menschen auf wachsende Komplexität.m4a';
    test.skip(!existsSync(media(file)), 'fixture missing');
    await page.goto('.');
    await page.getByLabel('Privatemode API key').fill(KEY);
    await page.getByRole('button', { name: 'Verify & save' }).click();
    await expect(page.locator('#chip')).toHaveText('sealed', { timeout: 120_000 });

    await page.getByLabel('Spoken language').selectOption('de');
    await page.locator('#picker').setInputFiles(media(file));

    const card = page.locator('.card').first();
    await expect(card.locator('.seg').first()).toBeVisible({ timeout: 240_000 });
    await expect(card).toContainText(/komplex/i);
  });
});
