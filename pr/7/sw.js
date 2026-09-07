/*
 * Service worker for installability only. It caches NOTHING, deliberately.
 *
 * hushscribe cannot work offline — every transcription needs api.privatemode.ai
 * — so a cache would buy nothing functional. What it would cost is real: a stale
 * cache can pin an old bundle, and this bundle carries the attestation verifier
 * and its pinned hash. If a fix ever ships for the SDK, every client must get it
 * on the next load, not whenever a cache expires.
 *
 * The fetch handler passes everything through to the network, exactly as it
 * would without a service worker. It answers exactly one request itself: the
 * POST the Android share sheet sends. See "share target" below.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

/* ═══ share target ═════════════════════════════════════════════════════════
 *
 * An installed PWA can appear in the Android share sheet, and the OS delivers
 * the shared file by POSTing a multipart form to the `share_target.action`
 * declared in manifest.webmanifest. There is no server to receive that POST and
 * there never will be (AGENT.md, rule 5), so this worker receives it instead:
 * it is the only code in the product that can answer a request.
 *
 * Two things it deliberately does not do:
 *
 *   - It does not write the file anywhere. The obvious recipe stores the share
 *     in Cache or IndexedDB; here the file is held in a plain variable and
 *     handed to the page over a MessagePort. Media never touches disk — that
 *     asymmetry (transcripts persist, media never does) is the product's, not
 *     an accident. A worker killed before the page collects loses the file, and
 *     the page says so rather than failing silently.
 *   - It does not resolve the action against the origin root. `/share-target`
 *     would be outside the manifest's scope on a project site (`/hushscribe/`)
 *     and wrong again for every PR preview (`/hushscribe/pr/<n>/`). Everything
 *     here is derived from `registration.scope` for that reason.
 */
const SHARE_TARGET = new URL('share-target', self.registration.scope).pathname;
const SHARE_LANDING = new URL('./?shared=1', self.registration.scope).href;

/** Files from the last share, waiting for a page to collect them. */
let shared = [];

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'POST' || new URL(request.url).pathname !== SHARE_TARGET) return;

  event.respondWith((async () => {
    // A malformed body must still land the user on the app rather than on an
    // error page: they shared a file, the least we owe them is the dropzone.
    try {
      shared = (await request.formData()).getAll('media').filter((f) => f instanceof File);
    } catch {
      shared = [];
    }
    return Response.redirect(SHARE_LANDING, 303);
  })());
});

/* The page asks once, on the load that the redirect above caused, and takes the
   files with it — this worker is a relay, not a store. */
self.addEventListener('message', (event) => {
  if (event.data !== 'take-shared') return;
  event.ports[0]?.postMessage(shared);
  shared = [];
});
