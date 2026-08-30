import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

/**
 * Every host the page is allowed to talk to. Extracted from the SDK's Wasm
 * binary rather than guessed:
 *   api.privatemode.ai            inference
 *   cdn.confidential.cloud        the signed manifest (/privatemode/v2)
 *   api.trustedservices.intel.com Intel PCS — SGX/TDX attestation collateral
 *   kdsintf.amd.com               AMD KDS — SEV-SNP VCEK certificates
 * Narrow this if a host turns out to be unused; never widen it to make an error
 * go away.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self' https://api.privatemode.ai https://cdn.confidential.cloud https://api.trustedservices.intel.com https://kdsintf.amd.com",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * The SDK's attestation verifier is a Wasm blob shipped inside the npm package.
 * It must be served same-origin — loading the thing that verifies the enclave
 * from someone else's CDN would make the proof circular (ARCHITECTURE.md §1.2).
 *
 * The package's `exports` map only exposes `.`, so the file cannot be imported
 * by subpath. This plugin reads it from disk instead, serves it in dev, emits it
 * at a stable path in the build, and pins its SHA-256 for `expectedWasmHash`.
 */
function privatemodeWasm() {
  const path = fileURLToPath(
    new URL('node_modules/privatemode-ai/dist/privatemode.wasm', import.meta.url),
  );
  const bytes = readFileSync(path);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return {
    name: 'privatemode-wasm',
    config: () => ({ define: { __WASM_SHA256__: JSON.stringify(sha256) } }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith('/privatemode.wasm')) return next();
        res.setHeader('Content-Type', 'application/wasm');
        res.end(bytes);
      });
    },
    generateBundle() {
      // Deliberately unhashed: browserWasmURL is a plain URL built at runtime.
      this.emitFile({ type: 'asset', fileName: 'privatemode.wasm', source: bytes });
    },
  };
}

/**
 * GitHub Pages cannot set response headers, so the CSP ships as a meta tag —
 * that is the real deployed policy, not a fallback (ARCHITECTURE.md §8.1).
 *
 * Build only: Vite's dev server injects inline scripts and a HMR websocket, and
 * loosening the policy to accommodate dev would mean shipping the loose version.
 */
function cspMeta() {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
  };
}

export default defineConfig(({ command }) => {
  /* The dev key prefill. Read explicitly rather than through VITE_*, so .env
     keeps one unprefixed name that the smoke suite reads too — and so this
     cannot be exposed by accident.
     Substituted with '' for `vite build`, which is what `vite preview`, CI, and
     GitHub Pages all serve. A key baked into a public bundle is a public key,
     and CI greps dist/ to keep that honest (ARCHITECTURE.md §8.2). */
  const devKey =
    command === 'serve' ? (loadEnv('development', process.cwd(), '').PRIVATEMODE_AI_API_KEY ?? '') : '';

  return {
    // A project site lives at /hushscribe/; a custom domain at /. Getting this
    // wrong is the classic "blank page on Pages, fine locally" bug, so the e2e
    // suite runs against `vite preview` with the same base.
    base: process.env.BASE_PATH ?? '/hushscribe/',
    plugins: [privatemodeWasm(), cspMeta()],
    define: { __DEV_API_KEY__: JSON.stringify(devKey) },
    build: { target: 'es2022', sourcemap: true },
    server: { port: 5173 },
    preview: { port: 4173 },
    test: {
      include: ['test/*.test.js'], // test/e2e/ belongs to Playwright
      environment: 'node',
    },
  };
});
