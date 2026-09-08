// The pieces a transcript is shown with — on a fresh result card and again in
// history. Rows seek when there is a player and are plain text when there isn't:
// history has no media, because the file was never stored (ARCHITECTURE.md §5.3).

import { el } from './dom';
import { copyToClipboard, download } from './media';
import { activeIndex, clock, toSRT, toTXT, toVTT } from './segments';
import type { Segment } from './types';

export interface CardHead {
  head: HTMLDivElement;
  /** Where the progress spinner, then the enclave measurement, then any failure goes. */
  chain: HTMLDivElement;
}

export function cardHead(name: string): CardHead {
  const head = el('div', { className: 'card-head' });
  const chain = el('div', { className: 'card-chain' });
  head.append(el('div', { className: 'card-name', textContent: name }), chain);
  return { head, chain };
}

export function segmentList(
  segments: readonly Segment[],
  media: HTMLMediaElement | null,
): HTMLDivElement {
  const list = el('div', { className: 'segs' });
  segments.forEach((s) => {
    const row = el(media ? 'button' : 'div', { className: 'seg' });
    row.append(
      el('time', { textContent: clock(s.start) }),
      el('span', { textContent: (s.text ?? '').trim() }),
    );
    if (media) {
      row.addEventListener('click', () => {
        media.currentTime = s.start;
        void media.play();
      });
    }
    list.append(row);
  });
  if (media) {
    media.addEventListener('timeupdate', () => {
      const i = activeIndex(segments, media.currentTime);
      [...list.children].forEach((row, n) => row.classList.toggle('on', n === i));
    });
  }
  return list;
}

type Download = [ext: string, data: string, type: string];

/** Without segments there are no timestamps, so no .vtt or .srt to offer. */
export function exportBar(
  name: string,
  segments: readonly Segment[] | null,
  extra: HTMLElement | null,
  plainText = '',
): HTMLDivElement {
  const bar = el('div', { className: 'row' });
  const stem = name.replace(/\.[^.]+$/, '');
  const text = segments ? toTXT(segments) : plainText;
  const files: Download[] = segments
    ? [
        ['.vtt', toVTT(segments), 'text/vtt'],
        ['.srt', toSRT(segments), 'text/plain'],
        ['.txt', text, 'text/plain'],
        ['.json', JSON.stringify(segments, null, 2), 'application/json'],
      ]
    : [
        ['.txt', text, 'text/plain'],
        ['.json', JSON.stringify({ text }, null, 2), 'application/json'],
      ];
  files.forEach(([ext, data, type]) => {
    const b = el('button', { textContent: ext });
    b.addEventListener('click', () => download(stem + ext, data, type));
    bar.append(b);
  });
  bar.append(copyButton(text));
  if (extra) bar.append(extra);
  return bar;
}

/* The button reports what happened instead of appearing to have worked. */
export function copyButton(text: string): HTMLButtonElement {
  // A stable hook: this button's label changes to 'Copied', so anything that
  // finds it by text stops finding it exactly when it matters.
  const b = el('button', { textContent: 'Copy' });
  b.dataset['act'] = 'copy';
  b.addEventListener('click', async () => {
    const ok = await copyToClipboard(text);
    b.textContent = ok ? 'Copied' : 'Copy blocked';
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  });
  return b;
}
