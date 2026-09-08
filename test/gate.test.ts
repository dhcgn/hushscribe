import { describe, expect, it } from 'vitest';
import {
  FORMATS, MAX_BYTES, SNIFF_BYTES, extensionOf, gate, isPlayable, sniffContainer, type Verdict,
} from '../src/gate';

const file = (name: string, size = 1024): Pick<File, 'name' | 'size'> => ({ name, size });

/**
 * The first bytes of real files in test-data/ (and test/fixtures/), captured with
 * xxd — not typed from a spec. Padded to SNIFF_BYTES with zeros, as a short read
 * of a real file would be.
 */
const head = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(SNIFF_BYTES);
  bytes.set(Uint8Array.from(hex.replace(/\s+/g, '').match(/../g) ?? [], (h) => parseInt(h, 16)));
  return bytes;
};
const HEAD = {
  // de_WhatsApp PTT-20260908-WA0000.opus — an Ogg page carrying an OpusHead packet
  opus: head('4f67 6753 0002 0000 0000 0000 0000 0000 0000 0000 0000 492a f6a0 0113 4f70 7573 4865 6164'),
  vorbis: head('4f67 6753 0002 0000 0000 0000 0000 987d cc5f 0000 0000 50a2 168e 011e 0176 6f72 6269 73'),
  flac: head('664c 6143 0000 0022 0900 0900 0001 5600'),
  wav: head('5249 4646 dc20 7900 5741 5645 666d 7420 1000 0000'),
  mp3: head('4944 3303 0000 0000 0547 5443 4f50 0000'),
  m4a: head('0000 001c 6674 7970 4d34 4120 0000 0200 4d34 4120 6973 6f6d 6973 6f32'),
  mp4: head('0000 0020 6674 7970 6973 6f6d 0000 0200 6973 6f6d 6973 6f32 6176 6331 6d70 3431'),
  webm: head('1a45 dfa3 9f42 8681 0142 f781 0142 f281 0442 f381 0842 8284 7765 626d 4287 8104'),
  // Same EBML header, DocType "matroska": the API does not take it, so neither may we.
  mkv: head('1a45 dfa3 a342 8681 0142 f781 0142 f281 0442 f381 0842 8288 6d61 7472 6f73 6b61'),
  // MPEG program stream: accepted by extension, but no container signature we trust.
  mpeg: head('0000 01ba 2100 0100 0180 0183 0000 01bb'),
  zeros: head(''),
  text: head(Buffer.from('not actually audio, just bytes').toString('hex')),
};

/** Narrow to the rejected branch, or fail the test right here. */
const rejected = (v: Verdict): Extract<Verdict, { ok: false }> => {
  if (v.ok) throw new Error('expected the gate to reject');
  return v;
};

describe('extensionOf', () => {
  it.each([
    ['a.mp3', 'mp3'],
    ['A.MP3', 'mp3'],
    ['my.talk.final.wav', 'wav'],
    ['de_Wie reagieren Menschen auf wachsende Komplexität.m4a', 'm4a'],
    ['noext', ''],
    ['.hidden', ''], // a leading dot is not an extension
  ])('%s -> %s', (name, ext) => expect(extensionOf(name)).toBe(ext));
});

describe('gate', () => {
  it.each(FORMATS)('accepts .%s', (ext) => {
    expect(gate(file(`speech.${ext}`))).toEqual({ ok: true });
  });

  // These are in test-data/ precisely because Privatemode does not accept them.
  it.each(['opus', 'mkv', 'aac', 'wma', 'txt'])('rejects .%s', (ext) => {
    const v = rejected(gate(file(`speech.${ext}`)));
    expect(v.reason).toBe('format');
    expect(v.why).toContain(`.${ext}`);
  });

  it('rejects a file with no extension', () => {
    expect(gate(file('recording'))).toMatchObject({ ok: false, reason: 'format' });
  });

  it('accepts exactly 50 MB', () => {
    expect(gate(file('a.mp3', MAX_BYTES))).toEqual({ ok: true });
  });

  it('rejects one byte over 50 MB', () => {
    const v = rejected(gate(file('a.mp3', MAX_BYTES + 1)));
    expect(v.reason).toBe('size');
    expect(v.why).toMatch(/50 MB limit/);
  });

  it('reports the actual size so the message is actionable', () => {
    expect(rejected(gate(file('a.mp3', 68 * 1048576))).why).toContain('68.0 MB');
  });

  // Zero bytes passes both other checks and fails confusingly at the API instead.
  it('rejects an empty file before it reaches the API', () => {
    expect(gate(file('a.mp3', 0))).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('checks format before size, so the message names the real problem', () => {
    expect(rejected(gate(file('huge.mkv', MAX_BYTES * 2))).reason).toBe('format');
  });
});

describe('sniffContainer', () => {
  it.each([
    ['opus', 'ogg'],
    ['vorbis', 'ogg'],
    ['flac', 'flac'],
    ['wav', 'wav'],
    ['mp3', 'mp3'],
    ['m4a', 'm4a'],
    ['mp4', 'mp4'],
    ['webm', 'webm'],
  ] as const)('%s bytes are an accepted %s container', (which, format) => {
    expect(sniffContainer(HEAD[which])).toBe(format);
  });

  it.each(['mkv', 'mpeg', 'zeros', 'text'] as const)('does not vouch for %s bytes', (which) => {
    expect(sniffContainer(HEAD[which])).toBeNull();
  });

  it('needs at least 12 bytes before it will say anything', () => {
    expect(sniffContainer(HEAD.opus.subarray(0, 11))).toBeNull();
    expect(sniffContainer(HEAD.opus.subarray(0, 12))).toBe('ogg');
  });
});

describe('gate with the file head', () => {
  // The WhatsApp case: .opus is not on the list, but the bytes are an Ogg file, which is.
  it('relabels a .opus voice note as .ogg and sends the bytes untouched', () => {
    expect(gate(file('PTT-20260908-WA0000.opus'), HEAD.opus)).toEqual({
      ok: true,
      sendAs: 'PTT-20260908-WA0000.ogg',
    });
  });

  it.each([
    ['clip.oga', HEAD.vorbis, 'clip.ogg'],
    ['clip.weba', HEAD.webm, 'clip.webm'],
    ['clip.aac', HEAD.m4a, 'clip.m4a'],
    ['clip.bin', HEAD.flac, 'clip.flac'],
    ['recording', HEAD.wav, 'recording.wav'], // no extension at all
    ['my.talk.final.opus', HEAD.opus, 'my.talk.final.ogg'], // only the last extension goes
  ])('%s -> %s', (name, bytes, sendAs) => {
    expect(gate(file(name), bytes)).toEqual({ ok: true, sendAs });
  });

  it('still rejects when the bytes are no accepted container either', () => {
    expect(rejected(gate(file('speech.mkv'), HEAD.mkv)).why).toContain('.mkv');
    expect(rejected(gate(file('speech.opus'), HEAD.zeros)).why).toContain('.opus');
    expect(gate(file('recording'), HEAD.text)).toMatchObject({ ok: false, reason: 'format' });
  });

  // Sniffing rescues names the API would refuse. It is not a lie detector for names it takes.
  it('never second-guesses an accepted extension', () => {
    expect(gate(file('a.mp3'), HEAD.opus)).toEqual({ ok: true });
    expect(gate(file('a.mpeg'), HEAD.mpeg)).toEqual({ ok: true });
  });

  it('applies the size and empty checks to a relabelled file too', () => {
    expect(rejected(gate(file('a.opus', MAX_BYTES + 1), HEAD.opus)).reason).toBe('size');
    expect(rejected(gate(file('a.opus', 0), HEAD.opus)).reason).toBe('empty');
  });

  it('behaves exactly as before when no head is given', () => {
    expect(gate(file('a.opus'))).toMatchObject({ ok: false, reason: 'format' });
  });
});

describe('playability', () => {
  // Transcribable but not playable in a browser — the card must not assume a player.
  it('does not claim mpga is playable', () => {
    expect(gate(file('a.mpga'))).toEqual({ ok: true });
    expect(isPlayable('a.mpga')).toBe(false);
  });

  it.each(['mp3', 'wav', 'ogg', 'm4a', 'webm', 'mp4'])('plays %s', (ext) =>
    expect(isPlayable(`a.${ext}`)).toBe(true));

  // No isVideo(): mp4/webm/ogg are containers that may hold audio only, so the
  // name cannot decide the element. media.ts probes the file (see probeMedia).
  it('exposes no extension-based video test', async () => {
    const exports: Record<string, unknown> = await import('../src/gate');
    expect(exports['isVideo']).toBeUndefined();
  });
});
