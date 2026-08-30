import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The manifest shape, taken from the real one at
 * https://cdn.confidential.cloud/privatemode/v2/manifest.json and mirrored in
 * test/fixtures/manifest.json.
 *
 * An earlier version of this file invented `{ digest }`. Production code was
 * written to match the invention, both agreed, every test passed, and the live
 * page showed "✓(manifes". A fake that does not mirror the real contract tests
 * nothing but itself — so this one is derived from a captured response.
 */
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
};

/** What the collapsed proof row should read for the manifest above. */
export const PROOF_LINE = `Genoa · ${MEASUREMENT.slice(0, 8)}`;

export const LINES = [
  'Right, let us start with the encryption story.',
  'The audio never leaves the tab in plaintext.',
  'It is encrypted here to a key only the enclave holds.',
  'So attestation happens before the first request?',
  'Correct. Verify the manifest, then the handshake.',
];

/**
 * Installs a stand-in for the Privatemode client at the one seam production code
 * exposes (ARCHITECTURE.md §6.2). The fake lives only here, so no mock code ever
 * reaches the bundle — and no test needs an API key or has to forge ciphertext.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{fail?: string, segmentSeconds?: number}} [opts]
 */
export async function installFakeClient(page, opts = {}) {
  await page.addInitScript(
    ({ manifest, lines, fail, segmentSeconds }) => {
      // The SDK exposes the manifest both parsed and as the raw bytes it verified.
      // Production hashes the bytes, so the fake must supply them too.
      const bytes = new TextEncoder().encode(JSON.stringify(manifest));
      globalThis.__HC_CLIENT = () => ({
        manifest,
        manifestBytes: bytes,
        async verify() {
          if (fail === 'verify') throw new Error('attestation rejected');
          return { manifest };
        },
        async refreshSecret() {},
        audio: {
          transcriptions: {
            create: async ({ response_format: format }) => {
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

/**
 * A real, playable WAV written to disk so tests can drive the actual file input.
 * Generated rather than committed: test-data/ holds ~84 MB of real speech for
 * smoke runs, and the GUI suite must stay cheap enough to run on every push.
 */
export function makeWav(name = 'board-meeting.wav', seconds = 12) {
  const rate = 8000;
  const frames = rate * seconds;
  const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + frames * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buf.writeInt16LE(Math.round(Math.sin(i / 12) * 8000), 44 + i * 2);

  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-results', 'fixtures');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, buf);
  return path;
}

/** A file the gate must reject: .opus is not in Privatemode's supported list. */
export function makeUnsupported(name = 'interview.opus') {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-results', 'fixtures');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(2048));
  return path;
}

/** Accepted by the gate but undecodable, so no duration and no honest price. */
export function makeUndecodable(name = 'garbled.mp3') {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-results', 'fixtures');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, Buffer.from('not actually audio, just bytes with an .mp3 name'));
  return path;
}

/** Real webm fixtures: one audio-only, one with a video track. Committed rather
 *  than generated, because the bug they guard against is only reachable with a
 *  genuine container — an extension cannot tell you what is inside one. */
export const webm = (which) =>
  join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', `${which}.webm`);
