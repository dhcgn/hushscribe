// Turning verbose_json segments into the formats a person can actually use.
// Pure: no DOM, no network. Tested in test/segments.test.ts.

import type { Segment } from './types';

type Segments = readonly Segment[] | null | undefined;

/**
 * Seconds -> HH:MM:SS.mmm (WebVTT) or HH:MM:SS,mmm (SubRip).
 * Negative and non-finite inputs are clamped, because one bad segment should not
 * produce a subtitle file the player silently refuses to load.
 */
export function stamp(seconds: number | undefined, sep = '.'): string {
  const s = seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const rest = (s % 60).toFixed(3).padStart(6, '0').replace('.', sep);
  return `${h}:${m}:${rest}`;
}

/** HH:MM:SS for the on-screen segment list — milliseconds are noise there. */
export const clock = (seconds: number): string => stamp(seconds).slice(0, 8);

const clean = (t: string | null | undefined): string => (t ?? '').trim();
const usable = (segs: Segments): Segment[] => (segs ?? []).filter((s) => clean(s.text));

export function toVTT(segments: Segments): string {
  const cues = usable(segments)
    .map((s) => `${stamp(s.start)} --> ${stamp(s.end)}\n${clean(s.text)}`)
    .join('\n\n');
  return `WEBVTT\n\n${cues}\n`;
}

export function toSRT(segments: Segments): string {
  return (
    usable(segments)
      .map((s, i) => `${i + 1}\n${stamp(s.start, ',')} --> ${stamp(s.end, ',')}\n${clean(s.text)}`)
      .join('\n\n') + '\n'
  );
}

export const toTXT = (segments: Segments): string =>
  usable(segments).map((s) => clean(s.text)).join(' ');

/** Index of the segment covering `t`, or -1. Used for the active-row highlight. */
export function activeIndex(segments: Segments, t: number): number {
  return (segments ?? []).findIndex((s) => t >= s.start && t < s.end);
}

// ── prompt budget ────────────────────────────────────────────────────────────
// Whisper reads at most 224 prompt tokens and silently drops the rest, so the
// only useful warning is an early one. Characters, not tokens: a tokenizer to
// police this would be more code than the warning is worth.
export const PROMPT_LIMITS = { near: 300, over: 360 } as const;

export type BudgetLevel = 'ok' | 'near' | 'over';
export interface PromptBudget {
  n: number;
  level: BudgetLevel;
  message: string;
}

export function promptBudget(text: string | null | undefined): PromptBudget {
  const n = (text ?? '').length;
  if (n > PROMPT_LIMITS.over) {
    return {
      n,
      level: 'over',
      message: `${n} characters — past the 224-token limit; only the first 224 tokens are used`,
    };
  }
  if (n > PROMPT_LIMITS.near) {
    return { n, level: 'near', message: `${n} characters — nearing the 224-token limit` };
  }
  return { n, level: 'ok', message: `${n} characters` };
}
