import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIGEST =
  'sha256:9f2c4a1e7b0d38f5c6a29e14bd7038aa5c1f6e92d4b8073ac5e1f92b6d40a7c3';

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
    ({ digest, lines, fail, segmentSeconds }) => {
      globalThis.__HC_CLIENT = () => ({
        manifest: { digest },
        async verify() {
          if (fail === 'verify') throw new Error('attestation rejected');
          return { manifest: { digest } };
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
    { digest: DIGEST, lines: LINES, fail: opts.fail ?? null, segmentSeconds: opts.segmentSeconds ?? 2 },
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
