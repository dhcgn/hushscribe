import { describe, expect, it } from 'vitest';
import {
  activeIndex, clock, promptBudget, stamp, toSRT, toTXT, toVTT,
} from '../src/segments.js';

const segs = [
  { start: 0, end: 2.5, text: 'Right, let us start.' },
  { start: 2.5, end: 5, text: '  The short version.  ' },
  { start: 5, end: 3723.456, text: 'And the long one.' },
];

describe('stamp', () => {
  it.each([
    [0, '00:00:00.000'],
    [1.5, '00:00:01.500'],
    [61.25, '00:01:01.250'],
    [3661, '01:01:01.000'],
    [3723.456, '01:02:03.456'],
  ])('%s s -> %s', (s, out) => expect(stamp(s)).toBe(out));

  it('uses a comma for SubRip', () => expect(stamp(1.5, ',')).toBe('00:00:01,500'));

  // One bad segment should not produce a subtitle file the player silently rejects.
  it.each([-1, NaN, Infinity, undefined])('clamps %s to zero', (bad) =>
    expect(stamp(bad)).toBe('00:00:00.000'));

  it('drops milliseconds for the on-screen list', () => expect(clock(3723.456)).toBe('01:02:03'));
});

describe('toVTT', () => {
  const vtt = toVTT(segs);

  it('starts with the required WEBVTT header', () => expect(vtt.startsWith('WEBVTT\n\n')).toBe(true));
  it('uses a dot as the millisecond separator', () => expect(vtt).toContain('00:00:00.000 --> 00:00:02.500'));
  it('trims cue text', () => expect(vtt).toContain('\nThe short version.'));
  it('separates cues with a blank line', () => expect(vtt.split('\n\n')).toHaveLength(4));
  it('ends with a newline', () => expect(vtt.endsWith('\n')).toBe(true));

  it('stays valid with no segments', () => expect(toVTT([])).toBe('WEBVTT\n\n\n'));
  it('survives a null segment list', () => expect(toVTT(null)).toContain('WEBVTT'));

  it('skips empty cues rather than emitting a blank one', () => {
    expect(toVTT([{ start: 0, end: 1, text: '   ' }, ...segs]).split('-->')).toHaveLength(4);
  });
});

describe('toSRT', () => {
  const srt = toSRT(segs);

  it('numbers cues from 1', () => expect(srt.startsWith('1\n')).toBe(true));
  it('uses a comma as the millisecond separator', () => expect(srt).toContain('00:00:00,000 --> 00:00:02,500'));

  it('renumbers after skipping empty cues, leaving no gap', () => {
    const out = toSRT([{ start: 0, end: 1, text: '' }, ...segs]);
    expect(out.match(/^\d+$/gm)).toEqual(['1', '2', '3']);
  });
});

describe('toTXT', () => {
  it('joins trimmed segment text with single spaces', () =>
    expect(toTXT(segs)).toBe('Right, let us start. The short version. And the long one.'));
  it('is empty for no segments', () => expect(toTXT([])).toBe(''));
});

describe('activeIndex', () => {
  it.each([
    [0, 0],
    [2.49, 0],
    [2.5, 1], // boundary belongs to the later segment
    [6, 2],
    [99999, -1],
  ])('t=%s -> %s', (t, i) => expect(activeIndex(segs, t)).toBe(i));

  it('returns -1 for no segments', () => expect(activeIndex([], 1)).toBe(-1));
});

describe('promptBudget', () => {
  it.each([
    [0, 'ok'],
    [300, 'ok'],
    [301, 'near'],
    [360, 'near'],
    [361, 'over'],
  ])('%s characters -> %s', (n, level) => expect(promptBudget('x'.repeat(n)).level).toBe(level));

  it('explains truncation only once it can actually happen', () => {
    expect(promptBudget('x'.repeat(400)).message).toContain('only the first 224 tokens');
    expect(promptBudget('x'.repeat(10)).message).not.toContain('224');
  });

  it('treats an absent prompt as empty', () => expect(promptBudget(undefined).n).toBe(0));
});

