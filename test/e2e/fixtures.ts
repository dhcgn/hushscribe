// Media fixtures for the GUI suite. Node only: these write files for Playwright
// to hand to the file input. The browser-side fake lives in fake-client.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'test-results', 'fixtures');

function write(name: string, bytes: Buffer): string {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, name);
  writeFileSync(path, bytes);
  return path;
}

/**
 * A real, playable WAV written to disk so tests can drive the actual file input.
 * Generated rather than committed: test-data/ holds ~84 MB of real speech for
 * smoke runs, and the GUI suite must stay cheap enough to run on every push.
 */
export function makeWav(name = 'board-meeting.wav', seconds = 12): string {
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
  return write(name, buf);
}

/**
 * A file the gate must reject: .mkv is not on Privatemode's list, and its bytes
 * are a Matroska EBML header, which shares its magic number with WebM but is not
 * WebM. Both the name and the content have to say no for this to be a real test.
 */
export function makeUnsupported(name = 'interview.mkv'): string {
  const ebml = Buffer.from('1a45dfa3a34286810142f7810142f2810442f381084282886d6174726f736b61', 'hex');
  return write(name, Buffer.concat([ebml, Buffer.alloc(2048)]));
}

/**
 * The WhatsApp voice-note case: an Ogg page carrying an OpusHead packet, named
 * .opus. Not on the list by name; an Ogg container by content. The first bytes are
 * those of test-data/de_WhatsApp PTT-20260908-WA0000.opus.
 */
export function makeOpus(name = 'PTT-20260908-WA0000.opus'): string {
  const ogg = Buffer.from('4f676753000200000000000000000000000000000000492af6a001134f7075734865616401013801803e0000000000', 'hex');
  return write(name, Buffer.concat([ogg, Buffer.alloc(2048)]));
}

/** Accepted by the gate but undecodable, so no duration and no honest price. */
export function makeUndecodable(name = 'garbled.mp3'): string {
  return write(name, Buffer.from('not actually audio, just bytes with an .mp3 name'));
}

/** Real webm fixtures: one audio-only, one with a video track. Committed rather
 *  than generated, because the bug they guard against is only reachable with a
 *  genuine container — an extension cannot tell you what is inside one. */
export const webm = (which: 'audio-only' | 'with-video'): string =>
  join(HERE, '..', 'fixtures', `${which}.webm`);
