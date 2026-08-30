/*
 * Service worker for installability only. It caches NOTHING, deliberately.
 *
 * hushscribe cannot work offline — every transcription needs api.privatemode.ai
 * — so a cache would buy nothing functional. What it would cost is real: a stale
 * cache can pin an old bundle, and this bundle carries the attestation verifier
 * and its pinned hash. If a fix ever ships for the SDK, every client must get it
 * on the next load, not whenever a cache expires.
 *
 * The fetch handler exists because browsers require one to offer installation.
 * It intentionally does not call respondWith, so every request goes to the
 * network exactly as it would without a service worker.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass through, always network */ });
