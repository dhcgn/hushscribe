// What a transcription costs, so the number is visible before the bill is.
// Pure: no DOM, no network. Tested in test/pricing.test.js.

/**
 * EUR per audio minute, from https://www.privatemode.ai/pricing (Speech-to-text).
 * Plus VAT where applicable. Rates move; PRICES_DATED is shown in the UI beside
 * every figure so a stale number is visibly stale rather than quietly wrong.
 */
export const RATES = Object.freeze({
  'whisper-large-v3': 0.014,
  'voxtral-mini-3b': 0.004,
});

export const PRICES_DATED = 'September 2026';
export const PRICING_URL = 'https://www.privatemode.ai/pricing';

/** EUR for `seconds` of audio on `model`, or null if either is unknown. */
export function estimateEur(seconds, model) {
  const rate = RATES[model];
  if (rate === undefined) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return (seconds / 60) * rate;
}

/** €0.17 — or "under €0.01", because "€0.00" reads as free. */
export function formatEur(eur) {
  if (eur === null || !Number.isFinite(eur)) return '';
  if (eur > 0 && eur < 0.01) return 'under €0.01';
  return `€${eur.toFixed(2)}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(s).padStart(2, '0')} s`;
  return `${s} s`;
}

/**
 * The line shown on a result card. Returns null when the duration could not be
 * read — an estimate nobody can check is worse than no estimate.
 */
export function estimateLine(seconds, model) {
  const eur = estimateEur(seconds, model);
  if (eur === null) return null;
  const rate = RATES[model].toFixed(3).replace(/0$/, '');
  return `${formatDuration(seconds)} · about ${formatEur(eur)} at €${rate}/min`;
}

/** Rate summary for the model picker, e.g. "€0.014/min". */
export const rateLabel = (model) =>
  RATES[model] === undefined ? '' : `€${RATES[model].toFixed(3).replace(/0$/, '')}/min`;
