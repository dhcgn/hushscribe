import { describe, expect, it } from 'vitest';
import {
  RATES, estimateEur, estimateLine, formatDuration, formatEur, rateLabel,
} from '../src/pricing.js';

describe('rates', () => {
  // https://www.privatemode.ai/pricing — Speech-to-text, September 2026.
  it('matches the published EUR-per-minute figures', () => {
    expect(RATES['whisper-large-v3']).toBe(0.014);
    expect(RATES['voxtral-mini-3b']).toBe(0.004);
  });

  it('is frozen, so a typo cannot quietly change what users are quoted', () => {
    expect(() => { RATES['whisper-large-v3'] = 99; }).toThrow();
  });
});

describe('estimateEur', () => {
  it('charges an hour of Whisper at 60 x the per-minute rate', () =>
    expect(estimateEur(3600, 'whisper-large-v3')).toBeCloseTo(0.84, 5));

  it('charges an hour of Voxtral at its own rate', () =>
    expect(estimateEur(3600, 'voxtral-mini-3b')).toBeCloseTo(0.24, 5));

  it('prices a 12-minute meeting', () =>
    expect(estimateEur(720, 'whisper-large-v3')).toBeCloseTo(0.168, 5));

  it.each([0, -5, NaN, Infinity, undefined])('returns null for a duration of %s', (bad) =>
    expect(estimateEur(bad, 'whisper-large-v3')).toBeNull());

  it('returns null for an unknown model rather than guessing', () =>
    expect(estimateEur(600, 'some-future-model')).toBeNull());
});

describe('formatEur', () => {
  it.each([
    [0.168, '€0.17'],
    [0.84, '€0.84'],
    [1.5, '€1.50'],
    [12, '€12.00'],
  ])('%s -> %s', (eur, out) => expect(formatEur(eur)).toBe(out));

  // "€0.00" reads as free, which it is not.
  it('says "under €0.01" instead of rounding a real charge to zero', () =>
    expect(formatEur(0.004)).toBe('under €0.01'));

  it('is empty when there is nothing to show', () => expect(formatEur(null)).toBe(''));
});

describe('formatDuration', () => {
  it.each([
    [45, '45 s'],
    [90, '1 min 30 s'],
    [720, '12 min 00 s'],
    [3600, '1 h 00 min'],
    [3900, '1 h 05 min'],
  ])('%s s -> %s', (s, out) => expect(formatDuration(s)).toBe(out));

  it('is empty for an unreadable duration', () => expect(formatDuration(NaN)).toBe(''));
});

describe('estimateLine', () => {
  it('states duration, cost, and the rate it used', () => {
    const line = estimateLine(720, 'whisper-large-v3');
    expect(line).toContain('12 min');
    expect(line).toContain('€0.17');
    expect(line).toContain('€0.014/min');
  });

  // An estimate nobody can check is worse than no estimate.
  it('is null when the duration could not be read', () =>
    expect(estimateLine(NaN, 'whisper-large-v3')).toBeNull());

  it('is null for an unknown model', () => expect(estimateLine(600, 'nope')).toBeNull());
});

describe('rateLabel', () => {
  it.each([
    ['whisper-large-v3', '€0.014/min'],
    ['voxtral-mini-3b', '€0.004/min'],
  ])('%s -> %s', (model, out) => expect(rateLabel(model)).toBe(out));

  it('is empty for a model with no published rate', () => expect(rateLabel('nope')).toBe(''));
});
