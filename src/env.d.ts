// Build-time constants, substituted by Vite `define` (vite.config.ts). Only the
// browser project sees these: no module a unit test imports may use one.

/** SHA-256 of the privatemode.wasm the build ships, pinned as expectedWasmHash. */
declare const __WASM_SHA256__: string;
/** The .env key prefill for `vite` dev. Always '' in a build (ARCHITECTURE.md §8.2). */
declare const __DEV_API_KEY__: string;
/** The tag being served, or 'dev' for anything that is not a release. */
declare const __APP_VERSION__: string;
/** Where the footer's version link goes: release notes for a tag, the PR for a preview. */
declare const __APP_VERSION_URL__: string;
