import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

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
function privatemodeWasm(): Plugin {
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
        if (!req.url?.split('?')[0]?.endsWith('/privatemode.wasm')) return next();
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
/**
 * ffmpeg.wasm single-threaded core, vendored same-origin like privatemode.wasm
 * above — it touches plaintext audio, so it is not coming from a CDN (§4, §1.2).
 * Only @ffmpeg/core (never @ffmpeg/core-mt): Pages sets no COOP/COEP headers,
 * so SharedArrayBuffer is unavailable. The ESM build is required: @ffmpeg/ffmpeg
 * spawns a module worker whose `import(coreURL)` fallback needs a default export,
 * which the UMD build does not have.
 *
 * Deliberately unhashed stable names: reencode.ts builds the URLs at runtime
 * from BASE_URL, the same idiom as browserWasmURL. Loaded lazily — fetched only
 * when the gate rejects and re-encoding actually runs.
 */
function ffmpegCore(): Plugin {
  const jsPath = fileURLToPath(
    new URL('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js', import.meta.url),
  );
  const wasmPath = fileURLToPath(
    new URL('node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm', import.meta.url),
  );
  const js = readFileSync(jsPath);
  const wasm = readFileSync(wasmPath);

  return {
    name: 'ffmpeg-core',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url?.endsWith('/ffmpeg-core.js')) {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(js);
          return;
        }
        if (url?.endsWith('/ffmpeg-core.wasm')) {
          res.setHeader('Content-Type', 'application/wasm');
          res.end(wasm);
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'ffmpeg-core.js', source: js });
      this.emitFile({ type: 'asset', fileName: 'ffmpeg-core.wasm', source: wasm });
    },
  };
}

function cspMeta(): Plugin {
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
    plugins: [privatemodeWasm(), ffmpegCore(), cspMeta()],
    /* Which build this is. Only a tag push sets APP_VERSION, so anything else —
       a local build, a PR preview — says so plainly instead of claiming a
       version it does not have. APP_VERSION_URL is where the footer link goes:
       the release notes for a tag, the pull request for a preview. */
    define: {
      __DEV_API_KEY__: JSON.stringify(devKey),
      __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? 'dev'),
      __APP_VERSION_URL__: JSON.stringify(
        process.env.APP_VERSION_URL ?? 'https://github.com/dhcgn/hushscribe/releases',
      ),
    },
    build: { target: 'es2022', sourcemap: true },
    /* Bind to localhost unless told otherwise. The dev container sets
       VITE_DEV_HOST=0.0.0.0 (its "all interfaces" is only the Docker network,
       which the port forwarder needs). Never widen this on a real machine: the
       dev server prefills the API key from .env into the page. */
    server: { port: 5173, host: process.env.VITE_DEV_HOST ?? 'localhost' },
    preview: { port: 4173, host: process.env.VITE_DEV_HOST ?? 'localhost' },
    test: {
      include: ['test/*.test.ts'], // test/e2e/ belongs to Playwright
      environment: 'node',
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'json-summary', 'html'],
        reportsDirectory: 'coverage',
        /* Only the modules Vitest can actually reach: the pure ones. The DOM
           modules are exercised by Playwright against the real bundle, and
           measuring them here would report a number that says more about the
           tool than the code. Including them at 0% would be just as misleading
           in the other direction, so the badge is labelled "unit coverage" and
           this list is what it means. See ARCHITECTURE.md §6.4. */
        include: [
          'src/gate.ts', 'src/segments.ts', 'src/pricing.ts', 'src/manifest.ts',
          'src/storage.ts', 'src/session.ts', 'src/share.ts',
        ],
        thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
      },
    },
  };
});
