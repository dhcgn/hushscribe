import type { Page } from '@playwright/test';
import type { Manifest } from 'privatemode-ai';
// Type-only, so nothing from src/ runs in Node. It also brings the
// `globalThis.__HC_CLIENT` declaration into scope for the injected script.
import type { TranscriptionClient } from '../../src/client';

/**
 * The manifest shape, taken from the real one at
 * https://cdn.confidential.cloud/privatemode/v2/manifest.json and mirrored in
 * test/fixtures/manifest.json.
 *
 * An earlier version of this file invented `{ digest }`. Production code was
 * written to match the invention, both agreed, every test passed, and the live
 * page showed "✓(manifes". A fake that does not mirror the real contract tests
 * nothing but itself — so this one is derived from a captured response, and
 * `satisfies Manifest` makes an invented field a compile error.
 */
declare global {
  /** Test-only: the file names the fake was asked to transcribe, in order. */
  // eslint-disable-next-line no-var
  var __HC_SENT: string[] | undefined;
}

export const MEASUREMENT =
  'ea6a66550b8b0117ba8dd0a86dcb1f9d5a4e5e6b9c1d2f3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2';

export const MANIFEST = {
  Policies: {
    '2018b610b08ca8f6950f3ee8c538c2c8ce3cf48378ffa5d5717b980127b438e1': {
      SANs: ['coordinator', '*'],
      WorkloadSecretID: 'apps/v1/StatefulSet/continuum-216de2/coordinator',
      Role: 'coordinator',
    },
    '3406d8bb6c047e20b8221f92180aa7c1e5f9d3b8a2c4e6f8091a2b3c4d5e6f70': {
      SANs: ['*'],
      WorkloadSecretID: 'apps/v1/Deployment/continuum-216de2/workload',
    },
  },
  ReferenceValues: {
    snp: [{
      ProductName: 'Genoa',
      TrustedMeasurement: MEASUREMENT,
      MinimumTCB: { BootloaderVersion: 4, TEEVersion: 0, SNPVersion: 22, MicrocodeVersion: 213 },
      GuestPolicy: {
        SMT: true, MigrateMA: false, Debug: false, CXLAllowed: false, PageSwapDisable: false,
      },
      PlatformInfo: { SMTEnabled: true, ECCEnabled: false, AliasCheckComplete: true },
      AllowedChipIDs: [],
    }],
  },
  SeedshareOwnerPubKeys: ['-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----'],
} satisfies Manifest;

/** What the collapsed proof row should read for the manifest above. */
export const PROOF_LINE = `Genoa · ${MEASUREMENT.slice(0, 8)}`;

export const LINES = [
  'Right, let us start with the encryption story.',
  'The audio never leaves the tab in plaintext.',
  'It is encrypted here to a key only the enclave holds.',
  'So attestation happens before the first request?',
  'Correct. Verify the manifest, then the handshake.',
];

type Failure = 'verify' | 'transcribe';

export interface FakeOptions {
  manifest?: Manifest;
  fail?: Failure;
  segmentSeconds?: number;
}

/** What crosses into the page. Must be structured-cloneable: no functions. */
interface FakeArgs {
  manifest: Manifest;
  lines: string[];
  fail: Failure | null;
  segmentSeconds: number;
}

/**
 * Installs a stand-in for the Privatemode client at the one seam production code
 * exposes (ARCHITECTURE.md §6.2). The fake lives only here, so no mock code ever
 * reaches the bundle — and no test needs an API key or has to forge ciphertext.
 *
 * The injected function is annotated with the production seam type, so a fake
 * that drifts from what the SDK actually exposes fails to compile.
 */
export async function installFakeClient(page: Page, opts: FakeOptions = {}): Promise<void> {
  await page.addInitScript(
    ({ manifest, lines, fail, segmentSeconds }: FakeArgs) => {
      // The SDK exposes the manifest both parsed and as the raw bytes it verified.
      // Production hashes the bytes, so the fake must supply them too.
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      globalThis.__HC_CLIENT = (): TranscriptionClient => ({
        manifestBytes: bytes,
        async verify() {
          if (fail === 'verify') throw new Error('attestation rejected');
          return { manifest };
        },
        async refreshSecret() {},
        audio: {
          transcriptions: {
            create: async ({ file, response_format: format }) => {
              // The name the API saw. A relabelled file must arrive under the new one.
              (globalThis.__HC_SENT ??= []).push(file.name);
              if (fail === 'transcribe') throw new Error('rate limited');
              const text = lines.join(' ');
              if (format !== 'verbose_json') return { text };
              return {
                text,
                segments: lines.map((line, i) => ({
                  id: i,
                  start: i * segmentSeconds,
                  end: (i + 1) * segmentSeconds,
                  text: line,
                })),
              };
            },
          },
        },
      });
    },
    {
      manifest: opts.manifest ?? MANIFEST,
      lines: LINES,
      fail: opts.fail ?? null,
      segmentSeconds: opts.segmentSeconds ?? 2,
    },
  );
}
