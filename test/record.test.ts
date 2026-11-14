import { describe, expect, it } from 'vitest';
import {
  formatElapsed, meterLevel, pickRecordingTarget, recordingFileName,
} from '../src/record';

describe('pickRecordingTarget', () => {
  it('prefers opus in webm', () => {
    expect(pickRecordingTarget(() => true)).toEqual({
      mimeType: 'audio/webm;codecs=opus',
      ext: 'webm',
    });
  });

  it('skips what the browser refuses', () => {
    const ok = (t: string): boolean => t.startsWith('audio/ogg');
    expect(pickRecordingTarget(ok)).toEqual({
      mimeType: 'audio/ogg;codecs=opus',
      ext: 'ogg',
    });
  });

  it('falls back to a default instead of failing when nothing matches', () => {
    expect(pickRecordingTarget(() => false)).toEqual({ mimeType: '', ext: 'webm' });
  });

  it('treats a throwing isTypeSupported as unsupported', () => {
    expect(pickRecordingTarget(() => { throw new Error('nope'); })).toEqual({
      mimeType: '',
      ext: 'webm',
    });
  });
});

describe('recordingFileName', () => {
  it('stamps the name with the chosen container', () => {
    const name = recordingFileName('webm', new Date(2026, 10, 14, 9, 30));
    expect(name).toBe('recording-20261114-0930.webm');
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [59000, '0:59'],
    [61000, '1:01'],
    [3600000, '60:00'],
  ])('%sms -> %s', (ms, text) => expect(formatElapsed(ms)).toBe(text));
});

describe('meterLevel', () => {
  it('reads silence as zero', () => {
    expect(meterLevel(new Uint8Array(2048).fill(128))).toBe(0);
  });

  it('reads a loud signal near full scale', () => {
    const data = new Uint8Array(2048).fill(0); // maximum deviation
    expect(meterLevel(data)).toBeGreaterThan(0.9);
  });

  it('detects a live mic well above the 0.02 silence threshold', () => {
    const data = new Uint8Array(2048);
    for (let i = 0; i < data.length; i++) data[i] = i % 2 ? 140 : 116; // ±12
    expect(meterLevel(data)).toBeGreaterThan(0.02);
  });

  it('a single spike barely registers', () => {
    const data = new Uint8Array(2048).fill(128);
    data[0] = 255;
    expect(meterLevel(data)).toBeLessThan(0.05);
  });
});
