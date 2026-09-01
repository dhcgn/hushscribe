# AGENT.md

Orientation for AI agents. Full reasoning lives in [ARCHITECTURE.md](ARCHITECTURE.md) — read
this first, that when you need the *why*.

## What this is

**hushscribe** — a static browser page that transcribes audio via
[Privatemode](https://www.privatemode.ai/) confidential-computing (TEE) inference. No
backend. The user brings an API key; audio is encrypted in the tab and readable only inside
an attested confidential VM. We supply a UI and none of the cryptography.

Live: https://dhcgn.github.io/hushscribe/ · Repo: `dhcgn/hushscribe`

## Layout

```
index.html          markup only — no inline <style>, no inline <script>
src/app.js          all DOM wiring, client lifecycle, transcribe loop
src/gate.js         pure: which files the API accepts, and why not
src/segments.js     pure: VTT/SRT/text, timestamps, prompt budget
src/pricing.js      pure: per-minute rates, cost estimates
src/manifest.js     pure: SNP measurement + manifest hash
public/             manifest.webmanifest, sw.js (no-cache), PWA icons
vite.config.js      base path, wasm plugin, CSP injection, dev-key mapping
test/*.test.js      vitest — the pure modules
test/e2e/           playwright — the real built bundle
```

The `src/*.js` split exists for exactly one reason: **those four modules are the logic worth
testing without a browser.** Everything else is DOM wiring Playwright covers. Don't add
layers for their own sake.

## Commands

```bash
npm run dev        # :5173
npm test           # unit + e2e, no API key needed
npm run test:unit  # fast, no browser
npm run test:e2e   # builds, serves dist/, drives real Chromium
npm run test:smoke # OPT-IN. Real enclave, real money. Needs .env
npm run build      # -> dist/
```

## Releasing

**Only tags publish.** A commit on `main` runs CI and stops there; the site keeps serving
the last tag, and the footer says which one and links to its notes.

```bash
npm test                                   # green before you tag anything
gh release create v0.2.0 --generate-notes  # tag + notes — this is the deploy trigger
gh run watch                               # deploy.yml, ~2 min
```

Create the tag *through* `gh release create`. A bare `git push --tags` deploys just the
same, but the footer's link then points at a release page that does not exist.
`--generate-notes` writes the notes from the PRs merged since the last tag; use
`--notes-file`/`--draft` to write them yourself, and `gh workflow run deploy.yml --ref
v0.2.0` to re-publish a tag unchanged.

Every PR publishes a throwaway copy to `…/hushscribe/pr/<n>/`, commented on the PR and
deleted when it closes. Fork PRs get none: their `GITHUB_TOKEN` is read-only.

## Hard rules

Breaking any of these breaks the product's entire claim. They are not style preferences.

1. **No third-party runtime code.** No CDN, analytics, Google Fonts, tag manager, tour
   library. Any third-party script can read the API key and the plaintext audio *before*
   encryption. This one rule carries most of the security weight.
2. **`privatemode.wasm` stays same-origin.** It *is* the attestation verifier; loading it
   from someone else's CDN makes the proof circular.
3. **No mock or bypass code in the bundle.** Fakes live in `test/e2e/` and reach production
   only through `globalThis.__HC_CLIENT` (one line in `app.js`).
4. **No dev key in a build.** `__DEV_API_KEY__` is `''` for every build; CI greps `dist/`
   for key-shaped strings and fails. A public Pages bundle is public to everyone.
5. **No backend.** Ever. A server that touches the audio voids the claim.
6. **The service worker caches nothing.** `public/sw.js` exists for installability only. A
   cache could pin an old bundle — and the bundle carries the attestation verifier plus its
   pinned hash. The app needs the network anyway.
7. **CSP has no `'unsafe-inline'`.** Never widen it to silence an error.
8. **Never overstate.** The UI states what is *not* covered (metadata, browser trust,
   `dangerouslyAllowBrowser`). Honesty is what makes the rest credible.

## Traps already paid for

Each of these cost real debugging time here. Don't rediscover them.

| Trap | Reality |
|---|---|
| `manifest.digest` | **Does not exist.** Use `ReferenceValues.snp[].TrustedMeasurement` (96 hex, SEV-SNP launch measurement). See `src/manifest.js`. |
| Fakes | Must mirror a **captured response**, never what the caller wants. An invented fake agreeing with invented production code shipped `✓(manifes` to users. |
| `language` | Optional in the API, but **`verbose_json` requires it**. No language → plain text, no timestamps. Degrade, don't demand. |
| Wrong language | Whisper doesn't fail, it **translates** — fluent prose that isn't what was said. |
| `style=""` attributes | Blocked in production. The CSP is injected on **build only**, so dev never shows the violation. An e2e test fails on any CSP console error. |
| `reuseExistingServer` | Stays `false`. `preview` serves `dist/`; a stale server silently tests a bundle that no longer exists. |
| Container vs codec | `.webm`/`.mp4`/`.ogg` may hold **audio only**. Never choose `<video>` vs `<audio>` by extension — probe the file (`probeMedia`), or an audio-only webm paints a black viewport. |
| `FileList` | Live reference. Snapshot with `[...files]` before any `await`, or the picker's reset empties it underneath you. |
| `clipboard.writeText` | Does **not** reject on an unfocused document — it hangs forever. Always race a timeout. |
| Test locators | Never match on text that changes (`name: 'Copy'` stops matching at `'Copied'`). Use `data-act="…"`. |
| Prompt | Whisper reads ≤224 tokens and silently drops the rest. |
| GitHub Pages | Serves the **`gh-pages` branch**, set manually once — `GITHUB_TOKEN` gets `Resource not accessible by integration` and cannot set it for you. Root is the release, `pr/<n>/` are previews, so a release deploy must delete the root *except* `pr/`. |
| `gh` with no checkout | A cleanup job that skips `actions/checkout` has no git repo, so `gh` cannot infer the repository: `fatal: not a git repository`. Set `GH_REPO`. |
| `${{ }}` over two lines | A wrapped expression containing a URL parses as a YAML mapping (`https:`) and the workflow will not load. One line, or build the string in the shell. |
| Git Bash on Windows | MSYS rewrites `!/path` args into `C:/Program Files/Git/...`. Use `MSYS_NO_PATHCONV=1` when verifying sparse-checkout patterns. |
| `python .replace()` edits | Fail **silently** on no-match. Assert the match, or use the Edit tool. |

## Design stance

Reach for the platform before a dependency: native `<details>` for disclosure, native
`<track>` + WebVTT for captions (no caption library), `<audio>`/`<video>` for playback,
`localStorage` for the five small values it holds. There is no framework and no router, and
the UI does not need one.

Where a shortcut has a known ceiling, it carries a `ponytail:` comment naming the ceiling and
the upgrade path. Keep that habit.

The compact view hides `.prose` only — teaching material. Warnings, prices, status, and the
attestation row stay visible in both views: a denser layout must not become a less honest
one. `public/view-init.js` applies the saved view before first paint because the CSP forbids
the usual inline anti-flash script.

Deliberate asymmetry worth preserving: **transcripts persist, media never does.** History has
no player and no Redo because the file was never stored — Redo lives on the result card,
where the `File` is in scope. Don't "fix" that by caching media.

## Where things stand

Stage 1 is done: supported formats, ≤50 MB, ≤1 h, rejected with a reason otherwise.
**Stage 2 is next** — ffmpeg re-encode for unsupported or oversized input, lazy-loaded,
single-threaded core (Pages sets no COOP/COEP headers). `test-data/` already holds `.opus`
files as its test case. Splitting on silence and speaker diarization are deferred with their
blockers recorded in ARCHITECTURE.md §9.

Before claiming anything works: run the tests, and for UI changes look at the real page.
Verify rather than assert — that habit caught every bug in the table above.
