// Boot and wiring. Everything with behaviour worth a name lives in a module;
// this file only connects index.html to those modules and starts the page.

import './style.css';
import { $, el, note, setKeyState, setView } from './dom';
import { renderData, renderHistory } from './history';
import { download, revokeAll } from './media';
import { PRICES_DATED, rateLabel } from './pricing';
import { deletePrompt, pickPrompt, renderCount, renderPrompts, savePrompt } from './prompts';
import { endSession, renderProof, verifyKey } from './proof';
import { K, buildExport, store, wipe } from './storage';
import { take, takeShared } from './transcribe';

/* An invisible iframe of a page holding an API key is worth blocking, and
   frame-ancestors is header-only — GitHub Pages gives us no headers (§8.1). */
if (self !== top) {
  document.body.textContent = 'hushscribe refuses to run inside a frame.';
  throw new Error('framed');
}

store.onWriteError = () =>
  note($('dataNote'), 'Browser storage is full or blocked — nothing was saved.', true);

const keyState = (): void => setKeyState(store.load(K.key, '') ? 'saved' : 'none');

function renderRate(): void {
  $('rate').textContent = `${rateLabel($('model').value)} of audio · ${PRICES_DATED} prices`;
}

function exportAll(): void {
  download(
    `hushscribe-export-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(buildExport(store, $('inclKey').checked), null, 2),
    'application/json',
  );
}

/* ═══ access ═══════════════════════════════════════════════════════════════ */
$('verify').addEventListener('click', () => { void verifyKey(); });
$('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') void verifyKey(); });
$('model').addEventListener('change', () => { store.save(K.model, $('model').value); renderRate(); });
$('lang').addEventListener('change', () => store.save(K.lang, $('lang').value));

/* Inside <summary>, so the click must not also toggle the disclosure. */
$('keyEdit').addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  setKeyState('editing');
  $('access').scrollIntoView({ block: 'center' });
  $('key').focus();
  $('key').select();
});

$('clearKey').addEventListener('click', () => {
  store.forget(K.key);
  $('key').value = '';
  keyState();
  endSession();
  note($('keyNote'), 'Key removed from this browser.');
  renderData();
});

$('mkLink').addEventListener('click', () => {
  const k = $('key').value.trim() || store.load(K.key, '');
  if (!k) return note($('keyNote'), 'No key to put in a link.', true);
  const url = `${location.origin}${location.pathname}#key=${encodeURIComponent(k)}`;
  const a = el('a', { href: url, textContent: 'hushscribe (bookmark me)' });
  $('keyNote').replaceChildren(a, document.createTextNode(
    ' — drag this to your bookmarks bar. The key rides in the URL fragment, so it never ' +
    'reaches a server or a log. It does land in browser history and synced bookmarks.'));
});

/* ═══ intake ═══════════════════════════════════════════════════════════════ */
const drop = $('drop');
const picker = $('picker');

drop.addEventListener('click', () => picker.click());
drop.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
});
picker.addEventListener('change', () => { void take(picker.files ?? []); picker.value = ''; });
(['dragenter', 'dragover'] as const).forEach((t) =>
  drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
(['dragleave', 'drop'] as const).forEach((t) =>
  drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { void take(e.dataTransfer?.files ?? []); });
// A file dropped outside the zone would otherwise navigate away and lose the page.
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());

/* ═══ prompts ══════════════════════════════════════════════════════════════ */
$('prompt').addEventListener('input', renderCount);
$('savePrompt').addEventListener('click', savePrompt);
$('prompts').addEventListener('change', pickPrompt);
$('delPrompt').addEventListener('click', deletePrompt);

/* ═══ view ═════════════════════════════════════════════════════════════════ */
$('viewToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset['view'] === 'compact' ? 'comfortable' : 'compact';
  store.save(K.view, next);
  setView(next);
});

/* ═══ data control ═════════════════════════════════════════════════════════ */
$('inclKey').addEventListener('change', () => { $('keyWarn').hidden = !$('inclKey').checked; });
$('ephemeral').addEventListener('change', () => store.save(K.ephemeral, $('ephemeral').checked));
$('exportAll').addEventListener('click', exportAll);
$('clearHist').addEventListener('click', () => { store.forget(K.hist); renderData(); renderHistory(); });
$('clearAll').addEventListener('click', () => {
  if (!confirm('Delete the API key, saved prompts, and all transcripts from this browser?')) return;
  wipe(store);
  keyState();
  endSession();
  revokeAll();
  $('key').value = '';
  $('prompt').value = '';
  $('lang').value = '';
  $('results').replaceChildren();
  renderPrompts(); renderData(); renderHistory(); renderCount();
  note($('keyNote'), 'All local data cleared.');
});

/* ═══ boot ═════════════════════════════════════════════════════════════════ */
/* Following a bookmark link while already on the page is a same-document
   navigation: nothing reloads, so this must run on hashchange too, not only at
   boot. Otherwise the key is silently ignored and left sitting in the URL bar. */
function consumeFragmentKey(): boolean {
  const k = new URLSearchParams(location.hash.slice(1)).get('key');
  if (!k) return false;
  // Strip it first, and whatever the answer below: a key sitting in the address
  // bar is the thing this mechanism exists to avoid.
  history.replaceState(null, '', location.pathname + location.search);
  // Any page anywhere can link here with a key in the fragment. Taking one
  // silently would replace the stored key and bill this tab to a stranger's
  // account, so this is the one storage write that has to be asked for.
  if (!confirm('This link carries an API key. Use it, replacing any key already saved in this browser?')) {
    return false;
  }
  store.save(K.key, k);
  return true;
}
addEventListener('hashchange', () => {
  if (!consumeFragmentKey()) return;
  $('key').value = store.load(K.key, '');
  note($('keyNote'), 'Key loaded from the bookmark link.');
  renderData();
});
consumeFragmentKey();

const savedKey = store.load(K.key, '');
// Dev convenience only: __DEV_API_KEY__ is substituted with '' for every build,
// so no key can reach the published site (§8.2). Prefills the field and nothing
// more — never saved on your behalf, never auto-verified.
const devKey = __DEV_API_KEY__;
$('key').value = savedKey || devKey || '';
if (!savedKey && devKey) note($('keyNote'), 'Key prefilled from .env (local development).');

$('lang').value = store.load(K.lang, '');
$('model').value = store.load(K.model, 'whisper-large-v3');
$('ephemeral').checked = store.load(K.ephemeral, false);
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

/* The version stamp in the footer, so the page can say which build you are
   looking at and link to its release notes (or, for a preview, its PR). */
Object.assign($('version'), { textContent: __APP_VERSION__, href: __APP_VERSION_URL__ });

setView(store.load(K.view, 'comfortable'));
keyState();
renderProof('idle');
renderPrompts(); renderData(); renderHistory(); renderCount(); renderRate();

/* Attest on load when there is a key to attest with, so the page is ready to
   take a file instead of demanding a click that has only one sensible answer.
   Attestation is a handshake, not an inference request, so it costs nothing but
   a round trip — though it does mean opening the page contacts the provider
   (ARCHITECTURE.md §1.3). A failure just surfaces the error and shows the field. */
const attested = $('key').value.trim() ? verifyKey() : Promise.resolve(false);

/* Only then go looking for a shared file. take() attests on demand, and the
   session shares a handshake already in flight rather than starting a second. */
void attested.then(takeShared);
