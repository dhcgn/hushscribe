// The five small values (and the transcript list) this app keeps in
// localStorage, with the type each key holds.
//
// Storage can be unavailable outright (private windows, blocked cookies), not
// just full. Every access is guarded, and the app stays usable without
// persistence — a failed write is reported through onWriteError, never thrown.
//
// Pure: no DOM. The backing store is a thunk so a test (or a browser with
// storage blocked) can make the very act of reaching for it throw.
// Tested in test/storage.test.ts.

import type { ExportFile, TranscriptRecord, View } from './types';

export const K = {
  key: 'hc.apiKey',
  prompts: 'hc.prompts',
  lang: 'hc.lang',
  model: 'hc.model',
  hist: 'hc.transcripts',
  view: 'hc.view',
  ephemeral: 'hc.ephemeral',
} as const;

/** What each key holds. A wrong type at a call site is a compile error. */
export interface Schema {
  'hc.apiKey': string;
  'hc.prompts': string[];
  'hc.lang': string;
  'hc.model': string;
  'hc.transcripts': TranscriptRecord[];
  'hc.view': View;
  'hc.ephemeral': boolean;
}

export type Key = keyof Schema;
export const KEYS: readonly Key[] = Object.values(K);

export const HISTORY_MAX = 20;

export interface Store {
  /** The stored value, or `fallback` when absent, unreadable, or storage is blocked. */
  load<Kk extends Key>(k: Kk, fallback: Schema[Kk]): Schema[Kk];
  /** True when written. False (after calling onWriteError) when storage is full or blocked. */
  save<Kk extends Key>(k: Kk, v: Schema[Kk]): boolean;
  forget(k: Key): void;
  /** Set by the UI to tell the user nothing was saved. Optional: a store can be silent. */
  onWriteError?: () => void;
}

export function createStore(backing: () => Storage): Store {
  const store: Store = {
    load(k, fallback) {
      try {
        const raw = backing().getItem(k);
        if (raw === null) return fallback;
        return (JSON.parse(raw) as Schema[typeof k] | null) ?? fallback;
      } catch {
        return fallback;
      }
    },
    save(k, v) {
      try {
        backing().setItem(k, JSON.stringify(v));
        return true;
      } catch {
        store.onWriteError?.();
        return false;
      }
    },
    forget(k) {
      try {
        backing().removeItem(k);
      } catch {
        /* nothing to do: a store that cannot be read holds nothing to forget */
      }
    },
  };
  return store;
}

/** The app's store. Lazy: importing this module in Node touches nothing. */
export const store: Store = createStore(() => localStorage);

/**
 * "Export everything" — the key only when explicitly asked for, and null (not
 * an empty string) when there is none, so a reader can tell the two apart.
 */
export function buildExport(s: Store, includeKey: boolean, now = new Date()): ExportFile {
  return {
    app: 'hushscribe',
    version: 1,
    exportedAt: now.toISOString(),
    apiKey: includeKey ? s.load(K.key, '') || null : null,
    prompts: s.load(K.prompts, []),
    lang: s.load(K.lang, ''),
    model: s.load(K.model, ''),
    transcripts: s.load(K.hist, []),
  };
}

/**
 * "Clear everything". Not saving transcripts is a setting, not data, so an
 * ephemeral flag that was on stays on: clearing data must not quietly hand the
 * user back the less private default.
 */
export function wipe(s: Store): void {
  const ephemeral = s.load(K.ephemeral, false);
  KEYS.forEach((k) => s.forget(k));
  if (ephemeral) s.save(K.ephemeral, true);
}
