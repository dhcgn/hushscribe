import { describe, expect, it } from 'vitest';
import { FORMATS, MAX_BYTES, extensionOf, gate, isPlayable, isVideo } from '../src/gate.js';

const file = (name, size = 1024) => ({ name, size });

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
    const v = gate(file(`speech.${ext}`));
    expect(v.ok).toBe(false);
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
    const v = gate(file('a.mp3', MAX_BYTES + 1));
    expect(v).toMatchObject({ ok: false, reason: 'size' });
    expect(v.why).toMatch(/50 MB limit/);
  });

  it('reports the actual size so the message is actionable', () => {
    expect(gate(file('a.mp3', 68 * 1048576)).why).toContain('68.0 MB');
  });

  // Zero bytes passes both other checks and fails confusingly at the API instead.
  it('rejects an empty file before it reaches the API', () => {
    expect(gate(file('a.mp3', 0))).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('checks format before size, so the message names the real problem', () => {
    expect(gate(file('huge.mkv', MAX_BYTES * 2)).reason).toBe('format');
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

  it.each(['mp4', 'webm', 'mpeg'])('treats %s as video', (ext) =>
    expect(isVideo(`a.${ext}`)).toBe(true));

  it.each(['mp3', 'wav', 'flac'])('treats %s as audio', (ext) =>
    expect(isVideo(`a.${ext}`)).toBe(false));
});
