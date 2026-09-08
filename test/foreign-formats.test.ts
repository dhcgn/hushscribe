import { describe, expect, it } from 'vitest';
import { FORMATS, SNIFF_BYTES, extensionOf, gate, sniffContainer } from '../src/gate';
import { inputNameFor, reencodedName } from '../src/reencode';

/**
 * Foreign formats: not on the API list, decodable by the vendored ffmpeg core,
 * and claimed by no container rescue — so a dropped file with one of these
 * names and bytes reaches the re-encode fallback.
 *
 * Only the routing contract is pinned here (extension + magic number → gate
 * rejection → mp3 naming). Actually running ffmpeg needs a browser, so the
 * transcode itself is covered by the Playwright suite.
 */
const pad = (nums: number[]): Uint8Array => {
  const out = new Uint8Array(SNIFF_BYTES);
  out.set(nums);
  return out;
};

const str = (...chars: string[]): number[] => chars.join('').split('').map((c) => c.charCodeAt(0));

const CASES = [
  {
    name: 'speech.mkv',
    // EBML header, DocType "matroska" — shares WebM's magic but is not WebM.
    head: [0x1a, 0x45, 0xdf, 0xa3, 0x82, 0x85, ...str('matroska')],
  },
  {
    name: 'speech.avi',
    // RIFF .... AVI — the RIFF branch only vouches for WAVE.
    head: [...str('RIFF'), 0x00, 0x00, 0x00, 0x00, ...str('AVI ')],
  },
  {
    name: 'speech.aac',
    // ADTS frame sync: no ID3 tag, no container signature the gate trusts.
    head: [0xff, 0xf1, 0x50, 0x40, 0x1c, 0xdf, 0xfc, 0xde, 0x04, 0x00, 0x4c, 0x61],
  },
  { name: 'speech.wma', head: [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa] },
  { name: 'speech.wmv', head: [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa] },
  {
    name: 'speech.aiff',
    // FORM .... AIFF — the WAVE check needs a RIFF tag, so this falls through.
    head: [...str('FORM'), 0x00, 0x00, 0x00, 0x00, ...str('AIFF')],
  },
  { name: 'speech.flv', head: [...str('FLV'), 0x01, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00] },
  // MPEG program stream — accepted by extension as .mpeg, foreign as .mpg.
  { name: 'speech.mpg', head: [0x00, 0x00, 0x01, 0xba, 0x21, 0x00, 0x01, 0x00, 0x01, 0x80, 0x01, 0x83] },
] as const;

describe('foreign format routing', () => {
  it.each(CASES.map((c) => c.name))('%s names no supported format', (name) => {
    expect(FORMATS).not.toContain(extensionOf(name));
  });

  it.each(CASES.map((c) => [c.name, c.head] as const))(
    'sniffing %s vouches for no accepted container',
    (_name, head) => {
      expect(sniffContainer(pad([...head]))).toBeNull();
    },
  );

  // The precondition the fallback relies on: rejected by name and by content,
  // so transcribe.ts sends the file to ffmpeg instead of the API as-is. If any
  // of these ever passes the gate, it silently leaves the re-encode path.
  it.each(CASES.map((c) => [c.name, c.head] as const))(
    '%s is rejected even with matching bytes',
    (name, head) => {
      expect(gate({ name, size: 1024 }, pad([...head]))).toMatchObject({
        ok: false,
        reason: 'format',
      });
    },
  );
});

describe('re-encoded naming', () => {
  it.each(CASES.map((c) => c.name))('%s is sent as mp3 under its own stem', (name) => {
    const stem = name.slice(0, name.lastIndexOf('.'));
    expect(reencodedName(name)).toBe(`${stem}.mp3`);
  });

  it('keeps the original extension as a demuxer hint, lowercased', () => {
    expect(inputNameFor('lecture.MKV')).toBe('input.mkv');
    expect(inputNameFor('speech.aac')).toBe('input.aac');
  });
});
