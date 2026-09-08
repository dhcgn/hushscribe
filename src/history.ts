// Transcripts persist, media never does. History shows text and offers exports;
// it has no player and no Redo, because the file was never stored (§5.3).

import { exportBar, segmentList } from './card';
import { $, el, note } from './dom';
import { shortHex } from './manifest';
import { HISTORY_MAX, K, store } from './storage';
import type { TranscriptRecord } from './types';

export function pushHistory(record: TranscriptRecord): void {
  const hist = store.load(K.hist, []);
  hist.unshift(record);
  store.save(K.hist, hist.slice(0, HISTORY_MAX));
  renderData();
  renderHistory();
}

export function renderHistory(): void {
  const box = $('history');
  const hist = store.load(K.hist, []);
  box.replaceChildren();
  if (!hist.length) {
    box.append(el('p', { className: 'empty', textContent: 'No transcripts yet. Finished ones land here.' }));
    return;
  }
  hist.forEach((h, i) => {
    const item = el('details', { className: 'hist' });
    const summary = el('summary');
    summary.append(
      el('span', { className: 'hist-name', textContent: h.name }),
      el('span', {
        className: 'hist-meta',
        textContent: `${new Date(h.at).toLocaleString()} · ${h.model} · ${h.lang}`,
      }),
    );
    // No Redo here: there is nothing to re-transcribe from. Redo lives on the
    // result card instead, where the File is still in scope.
    const del = el('button', { textContent: 'Delete' });
    del.addEventListener('click', () => {
      const list = store.load(K.hist, []);
      list.splice(i, 1);
      store.save(K.hist, list);
      renderHistory();
      renderData();
    });

    const body = el('div', { className: 'hist-body' });
    body.append(
      h.segments ? segmentList(h.segments, null) : el('p', { className: 'plain', textContent: h.text }),
      exportBar(h.name, h.segments, del, h.text),
    );
    if (h.measurement) {
      body.append(el('p', {
        className: 'hist-chain',
        textContent: `enclave ${shortHex(h.measurement, 12)}`,
        title: h.measurement,
      }));
    }
    item.append(summary, body);
    box.append(item);
  });
}

/** The one-line inventory under "Your data". */
export function renderData(): void {
  const h = store.load(K.hist, []).length;
  const p = store.load(K.prompts, []).length;
  note($('dataNote'),
    `${h} transcript${h === 1 ? '' : 's'}, ${p} saved prompt${p === 1 ? '' : 's'}, ` +
    `${store.load(K.key, '') ? 'API key saved' : 'no API key saved'}.`);
}
