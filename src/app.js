import { PrivatemodeAI } from 'privatemode-ai';
import './style.css';
import { gate, isPlayable, isVideo } from './gate.js';
import {
  clock, toVTT, toSRT, toTXT, activeIndex, promptBudget,
} from './segments.js';
import { PRICES_DATED, estimateLine, rateLabel } from './pricing.js';
import { digestHex, measurements, policySummary, proofSummary, shortHex } from './manifest.js';

/* An invisible iframe of a page holding an API key is worth blocking, and
   frame-ancestors is header-only — GitHub Pages gives us no headers (§8.1). */
if (self !== top) {
  document.body.textContent = 'hushscribe refuses to run inside a frame.';
  throw new Error('framed');
}

/* ═══ storage ══════════════════════════════════════════════════════════════ */
const K = {
  key: 'hc.apiKey', prompts: 'hc.prompts', lang: 'hc.lang',
  model: 'hc.model', hist: 'hc.transcripts',
};
const HISTORY_MAX = 20;

// Storage can be unavailable outright (private windows, blocked cookies), not
// just full. Every access is guarded; the app stays usable without persistence.
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; }
  catch { note($('dataNote'), 'Browser storage is full or blocked — nothing was saved.', true); return false; }
};
const forget = (k) => { try { localStorage.removeItem(k); } catch { /* nothing to do */ } };

const $ = (id) => document.getElementById(id);
const note = (el_, msg, warn) => { el_.textContent = msg; el_.classList.toggle('warn', !!warn); };
const el = (tag, props) => Object.assign(document.createElement(tag), props);

/* ═══ client ═══════════════════════════════════════════════════════════════ */
/* The one test-facing hook in shipped code. Playwright injects a fake through it
   (test/e2e/fake-client.js), so no mock ever reaches the bundle. */
const makeClient = globalThis.__HC_CLIENT ?? ((opts) => new PrivatemodeAI(opts));

let client = null;
let refreshTimer = null;
// The measurement each transcript is stamped with — its chain of custody.
let sealedMeasurement = '';

async function verify() {
  const apiKey = $('key').value.trim();
  if (!apiKey) return note($('keyNote'), 'Enter a key first.', true);

  setProof('verifying');
  note($('keyNote'), '');
  $('verify').disabled = true;
  try {
    client = makeClient({
      apiKey,
      dangerouslyAllowBrowser: true,            // §1.3 — key owner and user are the same person
      browserWasmURL: `${import.meta.env.BASE_URL}privatemode.wasm`, // same-origin, never a CDN
      expectedWasmHash: __WASM_SHA256__,        // pinned at build time
    });
    const { manifest } = await client.verify();
    // Hash the raw bytes, not a re-serialised object: the SDK warns JSON
    // round-tripping can alter them, and a digest nobody can reproduce is noise.
    const manifestDigest = await digestHex(client.manifestBytes);
    sealedMeasurement =
      measurements(manifest)[0]?.measurement ?? (manifestDigest ? `manifest ${manifestDigest}` : '');
    setProof('sealed', manifest, manifestDigest);
    save(K.key, apiKey);
    note($('keyNote'), 'Key saved in this browser.');

    // The encryption secret expires; keep it fresh for long sessions.
    // ponytail: fixed interval, not expiresAtUnix-driven. Revisit if a refresh
    // is ever actually missed.
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      client?.refreshSecret().catch((e) =>
        note($('keyNote'), `Lost the secure channel: ${e.message}`, true));
    }, 5 * 60_000);
  } catch (e) {
    client = null;
    sealedMeasurement = '';
    clearInterval(refreshTimer);
    setProof('idle');
    note($('keyNote'), `Verification failed: ${e.message}`, true);
  } finally {
    $('verify').disabled = false;
  }
}

function setProof(state, manifest, manifestDigest) {
  const chip = $('chip'), proof = $('proof');
  proof.dataset.state = chip.dataset.state = state;

  if (state !== 'sealed') {
    chip.textContent = state === 'verifying' ? 'verifying' : 'unverified';
    $('proofMark').textContent = '○';
    $('proofLine').textContent = state === 'verifying' ? 'Verifying…' : 'Not verified';
    return;
  }

  chip.textContent = 'sealed';
  $('proofMark').textContent = '✓';
  // Null means the manifest carried nothing worth quoting. Say "Verified" and
  // let the detail speak, rather than printing a placeholder that looks like a
  // measurement — which is exactly how "(manifest carried no digest)" shipped.
  $('proofLine').textContent = proofSummary(manifest, manifestDigest) ?? 'Verified';

  const rows = [];
  for (const { product, measurement } of measurements(manifest)) {
    rows.push(['SEV-SNP launch measurement', product ? `${measurement}  (${product})` : measurement]);
  }
  if (manifestDigest) rows.push(['Manifest SHA-256', manifestDigest]);
  // Not a defence — a page that lied about its own code would lie about this
  // too. It is an audit aid: compare it against a reproducible build of the SDK
  // (ARCHITECTURE.md §1.4). The enforcement is expectedWasmHash, which the SDK
  // checks before instantiation and which fails closed.
  rows.push(['Verifier Wasm SHA-256 (pinned, enforced)', __WASM_SHA256__]);
  const { count, roles } = policySummary(manifest);
  if (count) {
    rows.push(['Workload policies', `${count}${roles.length ? ` · ${roles.join(', ')}` : ''}`]);
  }

  const dl = el('dl', { className: 'proof-rows' });
  rows.forEach(([label, value]) => {
    dl.append(el('dt', { textContent: label }), el('dd', { textContent: value }));
  });
  $('digest').replaceChildren(dl);

  $('proofMeta').innerHTML =
    `Attested enclave, verified ${new Date().toLocaleTimeString()}. Every transcript records ` +
    'this measurement. <a href="https://docs.privatemode.ai/security/attestation/overview" target="_blank" rel="noreferrer">How attestation works</a> · ' +
    '<a href="https://cdn.confidential.cloud/privatemode/v2/manifest.json" target="_blank" rel="noreferrer">The manifest itself</a> · ' +
    '<a href="https://docs.privatemode.ai/reference/sdk/verify-from-source" target="_blank" rel="noreferrer">Verify the SDK from source</a> · ' +
    '<a href="https://github.com/dhcgn/hushscribe" target="_blank" rel="noreferrer">This page&rsquo;s source</a>';
}

/* ═══ transcribe ═══════════════════════════════════════════════════════════ */
const objectUrls = [];
const trackUrl = (u) => { objectUrls.push(u); return u; };

async function transcribe(file) {
  const card = el('article', { className: 'card' });
  $('results').prepend(card);

  const verdict = gate(file);
  if (!verdict.ok) {
    card.classList.add('bad');
    card.append(
      cardHead(file.name),
      el('p', { className: 'note warn', textContent: verdict.why }),
    );
    return;
  }

  const head = cardHead(file.name);
  head.querySelector('.card-chain').append(el('span', { className: 'spin' }), ' transcribing');
  card.append(head);

  // A file can be transcribable but not playable (mpga), so never assume a player.
  let media = null;
  if (isPlayable(file.name)) {
    media = el(isVideo(file.name) ? 'video' : 'audio', {
      src: trackUrl(URL.createObjectURL(file)),
      controls: true,
    });
    card.append(media);
  }

  // Billing is per audio minute, so the cost is knowable the moment the browser
  // reads the duration — which is long before the transcript comes back. Probed
  // separately from playback: pricing a file does not require rendering it.
  const priced = el('p', { className: 'price' });
  card.append(priced);
  probeDuration(file, media).then((seconds) => {
    const line = estimateLine(seconds, $('model').value);
    // No duration means no honest estimate, so say nothing at all.
    if (line) priced.textContent = `${line} · estimate, ${PRICES_DATED} prices`;
  });

  // Timestamps come from verbose_json, which the API accepts only alongside a
  // language. No language → plain text. Degrade, don't demand. (§3.3)
  const lang = $('lang').value;
  const prompt = $('prompt').value.trim();
  let res;
  try {
    res = await client.audio.transcriptions.create({
      model: $('model').value,
      file,
      ...(lang && { language: lang }),
      ...(prompt && { prompt }),
      response_format: lang ? 'verbose_json' : 'json',
    });
  } catch (e) {
    card.classList.add('bad');
    card.querySelector('.card-chain').textContent = `Failed: ${e.message}`;
    return;
  }

  const segments = res.segments?.length ? res.segments : null;
  // Git-style: enough to recognise, short enough not to dominate the card.
  const chain = card.querySelector('.card-chain');
  chain.textContent = shortHex(sealedMeasurement, 12);
  chain.title = sealedMeasurement;

  // Redo re-runs this same file with whatever model, language, and prompt are
  // selected *now* — the usual reason being a wrong language. Only offered here,
  // never in history, because history keeps text and never the media (§5.3).
  const redo = el('button', {
    textContent: 'Redo',
    title: 'Transcribe this file again with the settings currently selected above',
  });
  redo.dataset.act = 'redo';
  redo.addEventListener('click', () => take([file]));

  if (segments) {
    if (media) {
      // The browser renders the captions; we only hand it a VTT blob.
      media.append(el('track', {
        src: trackUrl(URL.createObjectURL(new Blob([toVTT(segments)], { type: 'text/vtt' }))),
        default: true, kind: 'captions', srclang: lang, label: lang,
      }));
    }
    card.append(segmentList(segments, media), exportBar(file.name, segments, redo));
  } else {
    card.append(
      el('p', { className: 'plain', textContent: res.text ?? '' }),
      exportBar(file.name, null, redo, res.text ?? ''),
      el('p', { className: 'note', textContent: 'Set a language to get timestamps and captions.' }),
    );
  }

  const at = new Date().toISOString();
  const hist = load(K.hist, []);
  hist.unshift({
    name: file.name, model: $('model').value, lang: lang || 'auto', at,
    measurement: sealedMeasurement,
    text: segments ? toTXT(segments) : (res.text ?? ''),
    segments,
  });
  save(K.hist, hist.slice(0, HISTORY_MAX));
  renderData(); renderHistory();
}

/**
 * Duration in seconds, or null if the browser cannot decode the container.
 * Reuses the visible player when there is one; otherwise probes with a detached
 * element, since a file we decline to render may still be priceable. Resolves
 * null rather than hanging when the format defeats the decoder.
 */
function probeDuration(file, existing) {
  return new Promise((resolve) => {
    const probe = existing ?? el('audio', { preload: 'metadata', src: URL.createObjectURL(file) });
    const done = (v) => {
      clearTimeout(timer);
      if (!existing) URL.revokeObjectURL(probe.src);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 5000);
    if (probe.readyState >= 1) return done(probe.duration);
    probe.addEventListener('loadedmetadata', () => done(probe.duration), { once: true });
    probe.addEventListener('error', () => done(null), { once: true });
  });
}

function cardHead(name) {
  const head = el('div', { className: 'card-head' });
  head.append(
    el('div', { className: 'card-name', textContent: name }),
    el('div', { className: 'card-chain' }),
  );
  return head;
}

/* Rows seek when there is a player and are plain text when there isn't —
   history has no media, because the file was never stored. */
function segmentList(segments, media) {
  const list = el('div', { className: 'segs' });
  segments.forEach((s) => {
    const row = el(media ? 'button' : 'div', { className: 'seg' });
    row.append(
      el('time', { textContent: clock(s.start) }),
      el('span', { textContent: (s.text ?? '').trim() }),
    );
    if (media) row.addEventListener('click', () => { media.currentTime = s.start; media.play(); });
    list.append(row);
  });
  if (media) {
    media.addEventListener('timeupdate', () => {
      const i = activeIndex(segments, media.currentTime);
      [...list.children].forEach((row, n) => row.classList.toggle('on', n === i));
    });
  }
  return list;
}

/* Without segments there are no timestamps, so no .vtt or .srt to offer. */
function exportBar(name, segments, extra, plainText) {
  const bar = el('div', { className: 'row' });
  const stem = name.replace(/\.[^.]+$/, '');
  const text = segments ? toTXT(segments) : (plainText ?? '');
  const files = segments
    ? [['.vtt', toVTT(segments), 'text/vtt'],
       ['.srt', toSRT(segments), 'text/plain'],
       ['.txt', text, 'text/plain'],
       ['.json', JSON.stringify(segments, null, 2), 'application/json']]
    : [['.txt', text, 'text/plain'],
       ['.json', JSON.stringify({ text }, null, 2), 'application/json']];
  files.forEach(([ext, data, type]) => {
    const b = el('button', { textContent: ext });
    b.addEventListener('click', () => download(stem + ext, data, type));
    bar.append(b);
  });
  bar.append(copyButton(text));
  if (extra) bar.append(extra);
  return bar;
}

/* Clipboard writes need a secure context and can be refused outright, so the
   button reports what happened instead of appearing to have worked. */
function copyButton(text) {
  // A stable hook: this button's label changes to 'Copied', so anything that
  // finds it by text stops finding it exactly when it matters.
  const b = el('button', { textContent: 'Copy' });
  b.dataset.act = 'copy';
  b.addEventListener('click', async () => {
    // Chromium does not reject when the document lacks focus — it leaves the
    // promise pending forever, which would leave this button silent. Always
    // report an outcome.
    const ok = await Promise.race([
      navigator.clipboard.writeText(text).then(() => true, () => false),
      new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    b.textContent = ok ? 'Copied' : 'Copy blocked';
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  });
  return b;
}

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ═══ intake ═══════════════════════════════════════════════════════════════ */
async function take(files) {
  // Snapshot before any await: `files` is a live FileList, and the picker's
  // change handler clears picker.value the moment this returns — which empties
  // it out from under us once this function starts awaiting verification.
  const queue = [...files];
  if (!queue.length) return;

  // Dropping a file is an unambiguous request to transcribe it, so do the
  // verification the user would otherwise have had to click through first.
  if (!client) {
    if (!$('key').value.trim()) {
      note($('keyNote'), 'Enter your API key first, then drop the file again.', true);
      $('key').focus();
      return;
    }
    await verify();
    if (!client) return; // verify() has already explained why
  }
  // Sequential: honest progress, no rate-limit games, less code.
  return queue.reduce((p, f) => p.then(() => transcribe(f)), Promise.resolve());
}

function renderRate() {
  $('rate').textContent = `${rateLabel($('model').value)} of audio · ${PRICES_DATED} prices`;
}

/* ═══ prompts ══════════════════════════════════════════════════════════════ */
function renderCount() {
  const { level, message } = promptBudget($('prompt').value);
  const c = $('count');
  c.dataset.level = level;
  c.textContent = message;
}

function renderPrompts() {
  const sel = $('prompts');
  sel.replaceChildren(el('option', { value: '', textContent: 'Saved prompts…' }));
  load(K.prompts, []).forEach((p, i) => {
    sel.append(el('option', {
      value: String(i),
      textContent: p.length > 46 ? `${p.slice(0, 46)}…` : p,
    }));
  });
}

/* ═══ history ══════════════════════════════════════════════════════════════ */
function renderHistory() {
  const box = $('history');
  const hist = load(K.hist, []);
  box.replaceChildren();
  if (!hist.length) {
    box.append(el('p', { className: 'empty', textContent: 'No transcripts yet. Finished ones land here.' }));
    return;
  }
  hist.forEach((h, i) => {
    const item = el('details', { className: 'hist' });
    const summary = el('summary');
    summary.append(
      el('span', { className: 'hist-name', textContent: h.name }),
      el('span', {
        className: 'hist-meta',
        textContent: `${new Date(h.at).toLocaleString()} · ${h.model} · ${h.lang}`,
      }),
    );
    // No Redo here: history stores text and never the media (§5.3), so there is
    // nothing to re-transcribe from. Redo lives on the result card instead.
    const del = el('button', { textContent: 'Delete' });
    del.addEventListener('click', () => {
      const list = load(K.hist, []);
      list.splice(i, 1);
      save(K.hist, list);
      renderHistory(); renderData();
    });

    const body = el('div', { className: 'hist-body' });
    body.append(
      h.segments ? segmentList(h.segments, null) : el('p', { className: 'plain', textContent: h.text }),
      exportBar(h.name, h.segments, del, h.text),
    );
    if (h.measurement) {
      body.append(el('p', {
        className: 'hist-chain',
        textContent: `enclave ${shortHex(h.measurement, 12)}`,
        title: h.measurement,
      }));
    }
    item.append(summary, body);
    box.append(item);
  });
}

/* ═══ data control ═════════════════════════════════════════════════════════ */
function renderData() {
  const h = load(K.hist, []).length;
  const p = load(K.prompts, []).length;
  note($('dataNote'),
    `${h} transcript${h === 1 ? '' : 's'}, ${p} saved prompt${p === 1 ? '' : 's'}, ` +
    `${load(K.key, null) ? 'API key saved' : 'no API key saved'}.`);
}

function exportAll() {
  download(
    `hushscribe-export-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({
      app: 'hushscribe', version: 1, exportedAt: new Date().toISOString(),
      apiKey: $('inclKey').checked ? load(K.key, null) : null,
      prompts: load(K.prompts, []), lang: load(K.lang, ''), model: load(K.model, ''),
      transcripts: load(K.hist, []),
    }, null, 2),
    'application/json',
  );
}

/* ═══ wiring ═══════════════════════════════════════════════════════════════ */
const drop = $('drop'), picker = $('picker');

$('verify').addEventListener('click', verify);
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });
$('prompt').addEventListener('input', renderCount);
$('lang').addEventListener('change', (e) => save(K.lang, e.target.value));
$('model').addEventListener('change', (e) => { save(K.model, e.target.value); renderRate(); });

drop.addEventListener('click', () => picker.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
});
picker.addEventListener('change', () => { take(picker.files); picker.value = ''; });
['dragenter', 'dragover'].forEach((t) =>
  drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) =>
  drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => take(e.dataTransfer.files));
// A file dropped outside the zone would otherwise navigate away and lose the page.
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

$('savePrompt').addEventListener('click', () => {
  const v = $('prompt').value.trim();
  if (!v) return;
  const list = load(K.prompts, []);
  if (!list.includes(v)) { list.push(v); save(K.prompts, list); renderPrompts(); }
});
$('prompts').addEventListener('change', (e) => {
  if (e.target.value === '') return;
  $('prompt').value = load(K.prompts, [])[e.target.value];
  renderCount();
});
$('delPrompt').addEventListener('click', () => {
  const sel = $('prompts');
  if (sel.value === '') return;
  const list = load(K.prompts, []);
  list.splice(Number(sel.value), 1);
  save(K.prompts, list); renderPrompts();
});

$('inclKey').addEventListener('change', (e) => { $('keyWarn').hidden = !e.target.checked; });
$('exportAll').addEventListener('click', exportAll);
$('clearHist').addEventListener('click', () => { forget(K.hist); renderData(); renderHistory(); });
$('clearKey').addEventListener('click', () => {
  forget(K.key); $('key').value = '';
  note($('keyNote'), 'Key removed from this browser.'); renderData();
});
$('clearAll').addEventListener('click', () => {
  if (!confirm('Delete the API key, saved prompts, and all transcripts from this browser?')) return;
  Object.values(K).forEach(forget);
  objectUrls.splice(0).forEach(URL.revokeObjectURL);
  $('key').value = ''; $('prompt').value = ''; $('lang').value = '';
  $('results').replaceChildren();
  renderPrompts(); renderData(); renderHistory(); renderCount();
  note($('keyNote'), 'All local data cleared.');
});
$('mkLink').addEventListener('click', () => {
  const k = $('key').value.trim() || load(K.key, '');
  if (!k) return note($('keyNote'), 'No key to put in a link.', true);
  const url = `${location.origin}${location.pathname}#key=${encodeURIComponent(k)}`;
  const a = el('a', { href: url, textContent: 'hushscribe (bookmark me)' });
  $('keyNote').replaceChildren(a, document.createTextNode(
    ' — drag this to your bookmarks bar. The key rides in the URL fragment, so it never ' +
    'reaches a server or a log. It does land in browser history and synced bookmarks.'));
});

/* ═══ boot ═════════════════════════════════════════════════════════════════ */
/* Following a bookmark link while already on the page is a same-document
   navigation: nothing reloads, so this must run on hashchange too, not only at
   boot. Otherwise the key is silently ignored and left sitting in the URL bar. */
function consumeFragmentKey() {
  const k = new URLSearchParams(location.hash.slice(1)).get('key');
  if (!k) return false;
  save(K.key, k);
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}
addEventListener('hashchange', () => {
  if (!consumeFragmentKey()) return;
  $('key').value = load(K.key, '');
  note($('keyNote'), 'Key loaded from the bookmark link.');
  renderData();
});
consumeFragmentKey();

const savedKey = load(K.key, '');
// Dev convenience only: __DEV_API_KEY__ is substituted with '' for every build,
// so no key can reach the published site (§8.2). Prefills the field and nothing
// more — never saved on your behalf, never auto-verified.
const devKey = __DEV_API_KEY__;
$('key').value = savedKey || devKey || '';
if (!savedKey && devKey) note($('keyNote'), 'Key prefilled from .env (local development).');

$('lang').value = load(K.lang, '');
$('model').value = load(K.model, 'whisper-large-v3');
// Open the walkthrough for people who never got as far as saving a key. No
// dismissed-flag to store or go stale.
$('guide').open = !savedKey;

/* Installability only — sw.js caches nothing on purpose (see public/sw.js).
   Dev is skipped: a service worker in front of Vite's HMR is pure confusion. */
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .catch(() => { /* installability is a nicety; never break the page over it */ });
}

setProof('idle');
renderPrompts(); renderData(); renderHistory(); renderCount(); renderRate();
