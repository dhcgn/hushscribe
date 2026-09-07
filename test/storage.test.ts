import { describe, expect, it, vi } from 'vitest';
import { K, KEYS, buildExport, createStore, wipe } from '../src/storage';
import type { TranscriptRecord } from '../src/types';

/** A Storage over a Map, with an optional way to make writes fail. */
function fakeStorage(opts: { full?: boolean } = {}): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.full) throw new DOMException('quota', 'QuotaExceededError');
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

/** A store over one persistent fake Storage. */
const fresh = () => { const backing = fakeStorage(); return createStore(() => backing); };

const record: TranscriptRecord = {
  name: 'a.wav', model: 'whisper-large-v3', lang: 'en', at: '2026-09-07T10:00:00.000Z',
  measurement: 'ea6a6655', text: 'hello', segments: [{ start: 0, end: 1, text: 'hello' }],
};

describe('load and save', () => {
  it('falls back when nothing is stored', () => {
    const s = fresh();
    expect(s.load(K.lang, 'de')).toBe('de');
    expect(s.load(K.hist, [])).toEqual([]);
  });

  it('round-trips every kind of value it holds', () => {
    const s = fresh();
    expect(s.save(K.hist, [record])).toBe(true);
    s.save(K.ephemeral, true);
    s.save(K.view, 'compact');
    expect(s.load(K.hist, [])).toEqual([record]);
    expect(s.load(K.ephemeral, false)).toBe(true);
    expect(s.load(K.view, 'comfortable')).toBe('compact');
  });

  it('falls back on unreadable JSON instead of throwing', () => {
    const backing = fakeStorage();
    backing.setItem(K.prompts, '{not json');
    backing.setItem(K.lang, 'null');
    const s = createStore(() => backing);
    expect(s.load(K.prompts, [])).toEqual([]);
    expect(s.load(K.lang, 'en')).toBe('en');
  });

  it('forgets a key', () => {
    const s = fresh();
    s.save(K.key, 'pm-secret');
    s.forget(K.key);
    expect(s.load(K.key, '')).toBe('');
  });
});

describe('when storage is full or blocked', () => {
  it('reports a full store through onWriteError and returns false', () => {
    const s = createStore(() => fakeStorage({ full: true }));
    const onWriteError = vi.fn();
    s.onWriteError = onWriteError;
    expect(s.save(K.lang, 'en')).toBe(false);
    expect(onWriteError).toHaveBeenCalledTimes(1);
  });

  it('stays usable when even reaching for storage throws', () => {
    // Private windows and blocked cookies make the localStorage getter itself
    // throw; the app must degrade to "no persistence", not die on boot.
    const s = createStore(() => { throw new Error('SecurityError'); });
    expect(s.load(K.model, 'whisper-large-v3')).toBe('whisper-large-v3');
    expect(s.save(K.model, 'voxtral-mini-3b')).toBe(false);
    expect(() => s.forget(K.model)).not.toThrow();
  });

  it('is silent when no one is listening for write errors', () => {
    const s = createStore(() => fakeStorage({ full: true }));
    expect(() => s.save(K.lang, 'en')).not.toThrow();
  });
});

describe('buildExport', () => {
  const now = new Date('2026-09-07T12:00:00.000Z');

  it('leaves the API key out unless explicitly asked', () => {
    const s = fresh();
    s.save(K.key, 'pm-secret');
    s.save(K.hist, [record]);
    s.save(K.prompts, ['names: Ada, Linus']);
    const dump = buildExport(s, false, now);
    expect(dump).toEqual({
      app: 'hushscribe', version: 1, exportedAt: '2026-09-07T12:00:00.000Z',
      apiKey: null, prompts: ['names: Ada, Linus'], lang: '', model: '', transcripts: [record],
    });
  });

  it('includes the key only when opted in', () => {
    const s = fresh();
    s.save(K.key, 'pm-secret');
    expect(buildExport(s, true, now).apiKey).toBe('pm-secret');
  });

  it('says null, not "", when there is no key to include', () => {
    expect(buildExport(fresh(), true, now).apiKey).toBeNull();
  });
});

describe('wipe', () => {
  it('forgets every key', () => {
    const backing = fakeStorage();
    const s = createStore(() => backing);
    s.save(K.key, 'k'); s.save(K.hist, [record]); s.save(K.view, 'compact');
    wipe(s);
    expect(backing.length).toBe(0);
    expect(KEYS).toHaveLength(7);
  });

  it('keeps ephemeral mode on: it is a setting, not data', () => {
    const backing = fakeStorage();
    const s = createStore(() => backing);
    s.save(K.ephemeral, true); s.save(K.hist, [record]);
    wipe(s);
    expect(s.load(K.ephemeral, false)).toBe(true);
    expect(s.load(K.hist, [])).toEqual([]);
  });

  it('does not invent an ephemeral flag that was off', () => {
    const backing = fakeStorage();
    wipe(createStore(() => backing));
    expect(backing.getItem(K.ephemeral)).toBeNull();
  });
});
