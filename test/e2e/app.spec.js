import { expect, test } from '@playwright/test';
import { DIGEST, LINES, installFakeClient, makeUnsupported, makeWav } from './fake-client.js';

const KEY = 'pm-test-key';

const wav = makeWav();
const opus = makeUnsupported();

/** Verify the key so the dropzone becomes live. */
async function unlock(page, lang = 'en') {
  await page.getByLabel('Privatemode API key').fill(KEY);
  await page.getByRole('button', { name: 'Verify & save' }).click();
  await expect(page.locator('#chip')).toHaveText('sealed');
  if (lang) await page.getByLabel('Spoken language').selectOption(lang);
}

test.beforeEach(async ({ page }) => {
  await installFakeClient(page);
  await page.goto('.');
});

test.describe('attestation', () => {
  test('starts unverified and shows the walkthrough to newcomers', async ({ page }) => {
    await expect(page.locator('#chip')).toHaveText('unverified');
    await expect(page.locator('#proofLine')).toHaveText('Not verified');
    await expect(page.locator('#guide')).toHaveAttribute('open', '');
  });

  test('collapses the proof to eight hex characters, full digest one click away', async ({ page }) => {
    await unlock(page);
    await expect(page.locator('#proofLine')).toHaveText('sha256:9f2c4a1e');
    await expect(page.locator('#proofMark')).toHaveText('✓');

    await expect(page.locator('#digest')).toBeHidden();
    await page.locator('#proof summary').click();
    await expect(page.locator('#digest')).toHaveText(DIGEST);
  });

  test('reports a failed attestation instead of proceeding', async ({ page }) => {
    await installFakeClient(page, { fail: 'verify' });
    await page.goto('.');
    await page.getByLabel('Privatemode API key').fill(KEY);
    await page.getByRole('button', { name: 'Verify & save' }).click();

    await expect(page.locator('#keyNote')).toContainText('attestation rejected');
    await expect(page.locator('#chip')).toHaveText('unverified');
  });

  test('refuses to transcribe before verification', async ({ page }) => {
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('#keyNote')).toContainText('Verify your API key first');
    await expect(page.locator('.card')).toHaveCount(0);
  });
});

test.describe('transcription', () => {
  test('with a language: timestamps, native captions, and click-to-seek', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);

    const card = page.locator('.card').first();
    await expect(card.locator('.seg')).toHaveCount(LINES.length);
    await expect(card.locator('.card-chain')).toHaveText(DIGEST);
    await expect(card.locator('.seg').first()).toContainText(LINES[0]);

    // The browser parsed our generated WebVTT — the whole reason there is no
    // caption library in this project.
    await expect
      .poll(() => card.locator('audio').evaluate((a) => a.textTracks[0]?.cues?.length ?? 0))
      .toBe(LINES.length);

    await card.locator('.seg').nth(2).click();
    expect(await card.locator('audio').evaluate((a) => a.currentTime)).toBeCloseTo(4, 1);

    for (const ext of ['.vtt', '.srt', '.txt', '.json']) {
      await expect(card.getByRole('button', { name: ext, exact: true })).toBeVisible();
    }
  });

  test('highlights the segment under the playhead', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    const card = page.locator('.card').first();
    await expect(card.locator('.seg')).toHaveCount(LINES.length);

    await card.locator('audio').evaluate((a) => {
      a.currentTime = 5;
      a.dispatchEvent(new Event('timeupdate'));
    });
    await expect(card.locator('.seg.on')).toHaveCount(1);
    await expect(card.locator('.seg.on')).toContainText(LINES[2]);
  });

  test('without a language: plain text, and no subtitle exports to offer', async ({ page }) => {
    await unlock(page, null);
    await page.locator('#picker').setInputFiles(wav);

    const card = page.locator('.card').first();
    await expect(card.locator('.plain')).toContainText(LINES[0]);
    await expect(card.locator('.seg')).toHaveCount(0);
    await expect(card.locator('track')).toHaveCount(0);
    await expect(card.locator('.row button')).toHaveText(['.txt', '.json']);
    await expect(card).toContainText('Set a language to get timestamps');
  });

  test('rejects an unsupported format by name, without calling the API', async ({ page }) => {
    await unlock(page);
    await page.locator('#picker').setInputFiles(opus);

    const card = page.locator('.card').first();
    await expect(card).toHaveClass(/bad/);
    await expect(card).toContainText('.opus is not a supported format');
    await expect(card.locator('.seg')).toHaveCount(0);
  });

  test('surfaces an API failure on the card rather than silently dropping it', async ({ page }) => {
    await installFakeClient(page, { fail: 'transcribe' });
    await page.goto('.');
    await unlock(page);
    await page.locator('#picker').setInputFiles(wav);

    const card = page.locator('.card').first();
    await expect(card).toHaveClass(/bad/);
    await expect(card.locator('.card-chain')).toContainText('rate limited');
  });
});

test.describe('history', () => {
  test('survives a reload and keeps text but never the media', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('.card .seg')).toHaveCount(LINES.length);

    await page.reload();
    const entry = page.locator('.hist').first();
    await expect(entry.locator('.hist-name')).toHaveText('board-meeting.wav');
    await expect(entry.locator('.hist-meta')).toContainText('whisper-large-v3');

    await entry.locator('summary').click();
    await expect(entry.locator('.seg')).toHaveCount(LINES.length);
    // No player: the file only ever existed in the tab it was dropped into.
    await expect(entry.locator('audio, video')).toHaveCount(0);
    await expect(entry.locator('.seg').first()).toHaveJSProperty('tagName', 'DIV');

    const stored = await page.evaluate(() => localStorage.getItem('hc.transcripts'));
    expect(stored).toContain(LINES[0]);
    expect(stored).not.toContain('blob:');
  });

  test('deletes a single entry without touching the rest', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles([wav, makeWav('second.wav', 6)]);
    await expect(page.locator('.hist')).toHaveCount(2);

    const first = page.locator('.hist').first();
    await first.locator('summary').click();
    await first.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.hist')).toHaveCount(1);
  });

  test('walkthrough collapses once a key has been saved', async ({ page }) => {
    await unlock(page);
    await page.reload();
    await expect(page.locator('#guide')).not.toHaveAttribute('open', '');
  });
});

test.describe('data control', () => {
  test('exports everything, and leaves the API key out by default', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('.hist')).toHaveCount(1);

    const download = await Promise.race([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export all data' }).click().then(() => page.waitForEvent('download')),
    ]);
    expect(download.suggestedFilename()).toMatch(/^hushscribe-export-\d{4}-\d{2}-\d{2}\.json$/);

    const dump = JSON.parse(await (await download.createReadStream()).toArray().then((c) => c.join('')));
    expect(dump.app).toBe('hushscribe');
    expect(dump.apiKey).toBeNull();               // opt-in only — an export travels
    expect(dump.transcripts[0].text).toContain(LINES[0]);
  });

  test('includes the key only when explicitly opted in, and warns', async ({ page }) => {
    await unlock(page);
    await page.locator('#inclKey').check();
    await expect(page.locator('#keyWarn')).toContainText('credential file');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export all data' }).click(),
    ]);
    const dump = JSON.parse(await (await download.createReadStream()).toArray().then((c) => c.join('')));
    expect(dump.apiKey).toBe(KEY);
  });

  test('clear everything empties storage and the results list', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('.hist')).toHaveCount(1);

    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Clear everything' }).click();

    await expect(page.locator('.card')).toHaveCount(0);
    await expect(page.locator('.empty')).toBeVisible();
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hc.')));
    expect(keys).toEqual([]);
  });
});

test.describe('prompt budget', () => {
  test('warns before truncation bites, not after', async ({ page }) => {
    const prompt = page.getByLabel(/Names and spellings/);
    const count = page.locator('#count');

    await prompt.fill('x'.repeat(299));
    await expect(count).toHaveAttribute('data-level', 'ok');

    await prompt.fill('x'.repeat(320));
    await expect(count).toHaveAttribute('data-level', 'near');

    await prompt.fill('x'.repeat(400));
    await expect(count).toHaveAttribute('data-level', 'over');
    await expect(count).toContainText('only the first 224 tokens are used');
  });

  test('saves and recalls a prompt', async ({ page }) => {
    const prompt = page.getByLabel(/Names and spellings/);
    await prompt.fill('Dr. Bergström, the Halvorsen case');
    await page.getByRole('button', { name: 'Save prompt' }).click();
    await prompt.fill('');

    await page.locator('#prompts').selectOption({ index: 1 });
    await expect(prompt).toHaveValue('Dr. Bergström, the Halvorsen case');
  });
});

test.describe('content security policy', () => {
  // The deployed policy is style-src 'self' with no 'unsafe-inline', so a single
  // style="" attribute silently breaks layout in production while looking fine
  // in dev. This is exactly the failure that test would otherwise not catch.
  test('the production page violates nothing', async ({ page }) => {
    const violations = [];
    page.on('console', (m) => /Content Security Policy/.test(m.text()) && violations.push(m.text()));

    await installFakeClient(page);
    await page.goto('.');
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('.card .seg')).toHaveCount(LINES.length);

    expect(violations).toEqual([]);
  });

  test('ships a policy that actually denies by default', async ({ page }) => {
    await page.goto('.');
    const policy = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');

    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).toContain('https://api.privatemode.ai');
    expect(policy).toContain('https://cdn.confidential.cloud');
  });
});

test('bookmark link carries the key in the fragment, never the query string', async ({ page }) => {
  await unlock(page);
  await page.getByRole('button', { name: 'Create bookmark link' }).click();

  const href = await page.locator('#keyNote a').getAttribute('href');
  expect(href).toContain(`#key=${KEY}`);
  expect(new URL(href).search).toBe('');

  // Same-document navigation: nothing reloads, so this only works if the
  // fragment is also consumed on hashchange.
  await page.goto(href);
  await expect(page.locator('#key')).toHaveValue(KEY);
  expect(page.url()).not.toContain(KEY);
});
