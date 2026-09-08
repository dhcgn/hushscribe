// What a transcription costs, so the number is visible before the bill is.
// Pure: no DOM, no network. Tested in test/pricing.test.ts.

/**
 * EUR per audio minute, from https://www.privatemode.ai/pricing (Speech-to-text).
 * Plus VAT where applicable. Rates move; PRICES_DATED is shown in the UI beside
 * every figure so a stale number is visibly stale rather than quietly wrong.
 */
export const RATES = Object.freeze({
  'whisper-large-v3': 0.014,
  'voxtral-mini-3b': 0.004,
});

export type ModelId = keyof typeof RATES;

export const PRICES_DATED = 'September 2026';
export const PRICING_URL = 'https://www.privatemode.ai/pricing';

/** The published rate for `model`, or undefined for a model we have no figure for. */
export const rateOf = (model: string): number | undefined =>
  Object.hasOwn(RATES, model) ? RATES[model as ModelId] : undefined;

/** EUR for `seconds` of audio on `model`, or null if either is unknown. */
export function estimateEur(seconds: number | null | undefined, model: string): number | null {
  const rate = rateOf(model);
  if (rate === undefined) return null;
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return (seconds / 60) * rate;
}

/** €0.17 — or "under €0.01", because "€0.00" reads as free. */
export function formatEur(eur: number | null): string {
  if (eur === null || !Number.isFinite(eur)) return '';
  if (eur > 0 && eur < 0.01) return 'under €0.01';
  return `€${eur.toFixed(2)}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

/** "€0.014" with the trailing zero of a three-decimal rate trimmed. */
const rateText = (rate: number): string => `€${rate.toFixed(3).replace(/0$/, '')}`;

/**
 * The line shown on a result card. Returns null when the duration could not be
 * read — an estimate nobody can check is worse than no estimate.
 */
export function estimateLine(seconds: number | null | undefined, model: string): string | null {
  const eur = estimateEur(seconds, model);
  const rate = rateOf(model);
  if (eur === null || rate === undefined || seconds === null || seconds === undefined) return null;
  return `${formatDuration(seconds)} · about ${formatEur(eur)} at ${rateText(rate)}/min`;
}

/** Rate summary for the model picker, e.g. "€0.014/min". */
export const rateLabel = (model: string): string => {
  const rate = rateOf(model);
  return rate === undefined ? '' : `${rateText(rate)}/min`;
};
