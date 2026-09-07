// Shared domain types. Everything here is a shape the app stores, exports, or
// renders — so each one is pinned to what the outside world actually produces.

import type { TranscriptionSegment } from 'openai/resources/audio/transcriptions';

/**
 * The slice of a verbose_json segment hushscribe reads and stores. Derived from
 * the OpenAI type so the source of truth is the API's own declaration, and
 * narrowed so that neither the e2e fake nor a stored transcript has to invent
 * the log-probabilities and token arrays the full type carries (§6.3).
 */
export type Segment = Pick<TranscriptionSegment, 'start' | 'end' | 'text'>;

/** One entry in the transcript history (localStorage `hc.transcripts`). */
export interface TranscriptRecord {
  name: string;
  model: string;
  lang: string;
  at: string;
  /** Absent in records written before the chain-of-custody stamp existed. */
  measurement?: string;
  text: string;
  segments: Segment[] | null;
}

/** The "Export everything" file, version 1. */
export interface ExportFile {
  app: 'hushscribe';
  version: 1;
  exportedAt: string;
  apiKey: string | null;
  prompts: string[];
  lang: string;
  model: string;
  transcripts: TranscriptRecord[];
}

export type ProofState = 'idle' | 'verifying' | 'sealed';
export type View = 'comfortable' | 'compact';
export type KeyState = 'none' | 'saved' | 'editing';
