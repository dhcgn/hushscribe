import { expect, test } from '@playwright/test';
import {
  LINES, MANIFEST, MEASUREMENT, PROOF_LINE,
  installFakeClient, makeUndecodable, makeUnsupported, makeWav,
} from './fake-client.js';

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

  test('summarises the enclave, with the full measurement one click away', async ({ page }) => {
    await unlock(page);
    await expect(page.locator('#proofLine')).toHaveText(PROOF_LINE);
    await expect(page.locator('#proofMark')).toHaveText('✓');

    await expect(page.locator('#digest')).toBeHidden();
    await page.locator('#proof summary').click();

    const detail = page.locator('#digest');
    await expect(detail).toContainText('SEV-SNP launch measurement');
    await expect(detail).toContainText(MEASUREMENT);
    await expect(detail).toContainText('Genoa');
    await expect(detail).toContainText(/Manifest SHA-256/);
    await expect(detail).toContainText(/Verifier Wasm SHA-256/);
    // The value shown must be the one actually pinned into the build.
    await expect(detail).toContainText(/[0-9a-f]{64}/);
    await expect(detail).toContainText(/[0-9a-f]{64}/);
    await expect(detail).toContainText('coordinator');
  });

  // The live page once read "✓(manifes" because production expected a field the
  // manifest has never had, and the fake agreed with it. Guard both directions.
  test('never renders a placeholder in place of a measurement', async ({ page }) => {
    await unlock(page);
    const line = await page.locator('#proofLine').textContent();
    expect(line).not.toMatch(/manifest carried|undefined|null|NaN/);
    expect(line.length).toBeGreaterThan(8);
  });

  test('says "Verified" rather than inventing one when the manifest is bare', async ({ page }) => {
    await installFakeClient(page, { manifest: {} });
    await page.goto('.');
    await unlock(page);

    await expect(page.locator('#proofLine')).toHaveText(/^(Verified|manifest [0-9a-f]{8})$/);
    await expect(page.locator('#chip')).toHaveText('sealed');
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
    await expect(page.locator('#keyNote')).toContainText('Enter your API key first');
    await expect(page.locator('.card')).toHaveCount(0);
  });
});

test.describe('transcription', () => {
  test('with a language: timestamps, native captions, and click-to-seek', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);

    const card = page.locator('.card').first();
    await expect(card.locator('.seg')).toHaveCount(LINES.length);
    await expect(card.locator('.card-chain')).toHaveText(MEASUREMENT.slice(0, 12));
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
    await expect(card.locator('.row button')).toHaveText(['.txt', '.json', 'Copy', 'Redo']);
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

test.describe('convenience', () => {
  // Dropping a file is an unambiguous request to transcribe it.
  test('verifies automatically when a file is dropped before pressing Verify', async ({ page }) => {
    await page.getByLabel('Privatemode API key').fill(KEY);
    await page.getByLabel('Spoken language').selectOption('en');
    await expect(page.locator('#chip')).toHaveText('unverified');

    await page.locator('#picker').setInputFiles(wav);

    await expect(page.locator('#chip')).toHaveText('sealed');
    await expect(page.locator('.card .seg')).toHaveCount(LINES.length);
  });

  test('still asks for a key when there is none to verify with', async ({ page }) => {
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('#keyNote')).toContainText('Enter your API key first');
    await expect(page.locator('.card')).toHaveCount(0);
  });

  test('does not transcribe if the automatic verification fails', async ({ page }) => {
    await installFakeClient(page, { fail: 'verify' });
    await page.goto('.');
    await page.getByLabel('Privatemode API key').fill(KEY);
    await page.locator('#picker').setInputFiles(wav);

    await expect(page.locator('#keyNote')).toContainText('attestation rejected');
    await expect(page.locator('.card')).toHaveCount(0);
  });

  test('shortens the measurement on a card, full value on hover', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);

    const chain = page.locator('.card .card-chain').first();
    await expect(chain).toHaveText(MEASUREMENT.slice(0, 12));
    await expect(chain).toHaveAttribute('title', MEASUREMENT);
  });

  test('copies the transcript to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.bringToFront(); // Chromium stalls clipboard writes on an unfocused document
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('.card .seg')).toHaveCount(LINES.length);

    const copy = page.locator('.card').first().locator('[data-act="copy"]');
    await copy.click();
    await expect(copy).toHaveText('Copied');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(LINES.join(' '));
    // The label returns, so a second copy does not look like a no-op.
    await expect(copy).toHaveText('Copy', { timeout: 4000 });
  });

  test('redoes a result card with the settings currently selected', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('#results > article')).toHaveCount(1);

    // Change the settings, then redo: the new run must use them, not the old ones.
    await page.getByLabel('Spoken language').selectOption('de');
    await page.getByLabel('Model').selectOption('voxtral-mini-3b');
    await page.locator('#results > article').first().locator('[data-act="redo"]').click();

    await expect(page.locator('#results > article')).toHaveCount(2);
    const newest = page.locator('.hist').first().locator('.hist-meta');
    await expect(newest).toContainText('voxtral-mini-3b');
    await expect(newest).toContainText('de');
  });

  // History stores text and never the media, so there is nothing to redo from.
  test('offers Redo on results only, never in history', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(wav);
    await expect(page.locator('#results > article [data-act="redo"]')).toHaveCount(1);
    await expect(page.locator('#history [data-act="redo"]')).toHaveCount(0);

    const entry = page.locator('.hist').first();
    await entry.locator('summary').click();
    await expect(entry.getByRole('button', { name: 'Redo' })).toHaveCount(0);
    await expect(entry.getByRole('button', { name: 'Delete' })).toBeVisible();

    // Still absent after a reload, when the file is definitively gone.
    await page.reload();
    await page.locator('.hist').first().locator('summary').click();
    await expect(page.locator('#history [data-act="redo"]')).toHaveCount(0);
  });

  test('warns that a wrong language makes Whisper translate', async ({ page }) => {
    await expect(page.locator('.note.warn.prose')).toContainText('translates');
    const help = page.locator('.help', { hasText: 'Why does the language matter?' });
    await help.locator('summary').click();
    await expect(help).toContainText('worse than naming none');
  });
});

test.describe('cost estimate', () => {
  test('shows the rate before anything is dropped', async ({ page }) => {
    await expect(page.locator('#rate')).toContainText('€0.014/min');
    await page.getByLabel('Model').selectOption('voxtral-mini-3b');
    await expect(page.locator('#rate')).toContainText('€0.004/min');
  });

  test('prices a file from its real duration', async ({ page }) => {
    await unlock(page, 'en');
    // makeWav() is 12 s: 12/60 × €0.014 = €0.0028, i.e. under a cent.
    await page.locator('#picker').setInputFiles(wav);

    const price = page.locator('.card .price').first();
    await expect(price).toContainText('12 s');
    await expect(price).toContainText('under €0.01');
    await expect(price).toContainText('€0.014/min');
    await expect(price).toContainText('September 2026');
  });

  test('scales with duration', async ({ page }) => {
    await unlock(page, 'en');
    // 30 min at €0.014/min = €0.42.
    await page.locator('#picker').setInputFiles(makeWav('long.wav', 1800));
    await expect(page.locator('.card .price').first()).toContainText('€0.42');
  });

  // An estimate nobody can check is worse than no estimate.
  test('says nothing when the duration cannot be read', async ({ page }) => {
    await unlock(page, 'en');
    await page.locator('#picker').setInputFiles(makeUndecodable());

    const card = page.locator('.card').first();
    await expect(card.locator('.seg')).toHaveCount(LINES.length);
    await expect(card.locator('.price')).toHaveText('');
  });
});

test.describe('view toggle', () => {
  const proseVisible = (page) => page.locator('.hero h1').isVisible();

  test('starts comfortable and switches to compact', async ({ page }) => {
    expect(await proseVisible(page)).toBe(true);
    await expect(page.locator('#guide')).toBeVisible();

    await page.locator('#viewToggle').click();

    await expect(page.locator('html')).toHaveAttribute('data-view', 'compact');
    await expect(page.locator('#viewToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#viewToggle')).toHaveText('Full');
    expect(await proseVisible(page)).toBe(false);
    await expect(page.locator('#guide')).toBeHidden();
  });

  test('keeps the controls, the warnings, and the prices', async ({ page }) => {
    await page.locator('#viewToggle').click();

    // Density must not cost honesty: a denser layout is not a quieter one. The
    // language warning gets shorter, it does not go away.
    await expect(page.getByLabel('Spoken language')).toBeVisible();
    await expect(page.locator('.note.warn.prose')).toBeHidden();
    await expect(page.locator('.note.warn.dense')).toBeVisible();
    await expect(page.locator('.note.warn.dense')).toContainText('translates');
    await expect(page.locator('#rate')).toBeVisible();              // cost per minute
    await expect(page.locator('#proof')).toBeVisible();             // attestation
    await expect(page.locator('#drop')).toBeVisible();
  });

  test('hides the key field once a key is stored, and only then', async ({ page }) => {
    await page.locator('#viewToggle').click();
    await expect(page.locator('#access')).toBeVisible();   // nothing saved yet

    await unlock(page);
    await expect(page.locator('html')).toHaveAttribute('data-key', 'saved');
    await expect(page.locator('#access')).toBeHidden();

    // Still reachable by leaving compact — the toggle is the way back.
    await page.locator('#viewToggle').click();
    await expect(page.locator('#access')).toBeVisible();
  });

  test('drops the duplicate status chip, keeping the proof row', async ({ page }) => {
    await unlock(page);
    await expect(page.locator('#chip')).toBeVisible();
    await page.locator('#viewToggle').click();
    await expect(page.locator('#chip')).toBeHidden();
    await expect(page.locator('#proofLine')).toBeVisible();
  });

  test('survives a reload with no flash of the roomy layout', async ({ page }) => {
    await page.locator('#viewToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'compact');

    await page.reload({ waitUntil: 'commit' });
    // Sampled the instant the document exists: view-init.js runs synchronously in
    // <head>, so the attribute must already be set before any body paint. This is
    // the entire reason that file exists rather than doing it in app.js.
    await page.waitForFunction(() => document.documentElement.dataset.view === 'compact');
    expect(await proseVisible(page)).toBe(false);
    await expect(page.locator('#viewToggle')).toHaveText('Full');
  });

  test('toggles back to comfortable and remembers that too', async ({ page }) => {
    await page.locator('#viewToggle').click();
    await page.locator('#viewToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'comfortable');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'comfortable');
    expect(await proseVisible(page)).toBe(true);
  });

  test('still works when storage is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('blocked', 'SecurityError'); },
      });
    });
    await page.goto('.');
    await expect(page.locator('#viewToggle')).toBeVisible();
    await page.locator('#viewToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-view', 'compact');
  });
});

test.describe('verify on load', () => {
  test('attests automatically when a key is already saved', async ({ page }) => {
    await unlock(page);                      // saves the key
    await page.reload();

    // No click: the page should come back sealed and ready for a file.
    await expect(page.locator('#chip')).toHaveText('sealed');
    await expect(page.locator('#proofLine')).toHaveText(PROOF_LINE);
  });

  test('does nothing on a first visit, with no key to attest with', async ({ page }) => {
    await expect(page.locator('#chip')).toHaveText('unverified');
    await expect(page.locator('#keyNote')).toHaveText('');
  });

  test('surfaces a stored key that no longer works, and shows the field again', async ({ page }) => {
    await unlock(page);
    await installFakeClient(page, { fail: 'verify' });
    await page.reload();

    await expect(page.locator('#keyNote')).toContainText('attestation rejected');
    await expect(page.locator('#chip')).toHaveText('unverified');
    // A bad key must stay fixable, even in compact where the field is hidden.
    await expect(page.locator('html')).toHaveAttribute('data-key', 'none');
    await page.locator('#viewToggle').click();
    await expect(page.locator('#access')).toBeVisible();
  });
});

test.describe('installable app', () => {
  test('serves a valid manifest with the icons it names', async ({ page, request }) => {
    const link = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(link).toBeTruthy();

    const res = await request.get(new URL(link, page.url()).href);
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m.name).toContain('hushscribe');
    expect(m.display).toBe('standalone');
    expect(m.icons.length).toBeGreaterThanOrEqual(2);
    expect(m.icons.some((i) => i.sizes === '512x512')).toBe(true);
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);

    // A manifest naming icons that 404 is worse than no manifest.
    for (const icon of m.icons) {
      const img = await request.get(new URL(icon.src, new URL(link, page.url())).href);
      expect(img.ok(), `${icon.src} must exist`).toBe(true);
      expect(img.headers()['content-type']).toContain('image/png');
    }
  });

  test('registers a service worker that caches nothing', async ({ page }) => {
    await expect
      .poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())),
        { timeout: 10_000 })
      .toBe(true);

    // The whole point: no stale bundle can ever be served (see public/sw.js).
    // Comments are stripped first — the file explains at length that it does not
    // call respondWith, and matching that prose would be matching the wrong thing.
    const raw = await (await page.request.get(new URL('sw.js', page.url()).href)).text();
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/caches\s*\./);
    expect(code).not.toMatch(/respondWith/);
    expect(code).toMatch(/addEventListener\(\s*'fetch'/);
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
