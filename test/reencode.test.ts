import { describe, expect, it } from 'vitest';
import {
  REENCODE_BITRATES,
  fitsAfterReencode,
  inputNameFor,
  reencodedName,
} from '../src/reencode';
import { MAX_BYTES } from '../src/gate';

describe('reencode naming', () => {
  it.each([
    ['interview.mkv', 'interview.mp3'],
    ['clip.MOV', 'clip.mp3'],
    ['my.talk.final.aac', 'my.talk.final.mp3'],
    ['recording', 'recording.mp3'],
    ['.hidden', '.hidden.mp3'],
  ])('%s -> %s', (name, sendAs) => expect(reencodedName(name)).toBe(sendAs));

  it.each([
    ['interview.mkv', 'input.mkv'],
    ['CLIP.MOV', 'input.mov'],
    ['recording', 'input'],
    ['weird name!.mkv', 'input.mkv'],
  ])('input for %s is %s', (name, input) => expect(inputNameFor(name)).toBe(input));
});

describe('reencode plan', () => {
  it('tries 128 kbit/s first, then 64, then stops', () => {
    expect([...REENCODE_BITRATES]).toEqual([128, 64]);
  });

  it('accepts exactly 50 MB after re-encoding', () => {
    expect(fitsAfterReencode(MAX_BYTES)).toBe(true);
  });

  it('rejects one byte over 50 MB after re-encoding', () => {
    expect(fitsAfterReencode(MAX_BYTES + 1)).toBe(false);
  });
});
