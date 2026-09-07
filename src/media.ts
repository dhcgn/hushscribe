// Browser media plumbing: what a file holds, object URLs, downloads, clipboard.

import { el } from './dom';

export interface MediaProbe {
  /** Seconds, or null when the browser could not decode the file. */
  duration: number | null;
  hasVideo: boolean;
}

const UNREADABLE: MediaProbe = { duration: null, hasVideo: false };

/**
 * What the file actually holds: its duration, and whether there is a video track.
 * A detached <video> reports videoWidth/Height of 0 for audio-only content, which
 * is the only reliable way to tell — the extension names a container, not tracks.
 *
 * Resolves with nulls rather than hanging when the format defeats the decoder, so
 * an undecodable file costs a bounded wait and simply gets no estimate.
 */
export function probeMedia(file: File, timeoutMs = 5000): Promise<MediaProbe> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = el('video', { preload: 'metadata', src: url });
    const done = (v: MediaProbe): void => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(UNREADABLE), timeoutMs);
    probe.addEventListener('loadedmetadata', () => done({
      duration: probe.duration,
      hasVideo: probe.videoWidth > 0 && probe.videoHeight > 0,
    }), { once: true });
    probe.addEventListener('error', () => done(UNREADABLE), { once: true });
  });
}

/* Object URLs for players and caption tracks live as long as their card does;
   "Clear everything" revokes them all. */
const objectUrls: string[] = [];

export const trackUrl = (url: string): string => {
  objectUrls.push(url);
  return url;
};

export function revokeAll(): void {
  objectUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
}

export function download(name: string, data: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * True when the text reached the clipboard. Clipboard writes need a secure
 * context and can be refused outright — and Chromium does not reject when the
 * document lacks focus, it leaves the promise pending forever. So this always
 * settles, and the caller always has an outcome to report.
 */
export function copyToClipboard(text: string, timeoutMs = 2000): Promise<boolean> {
  return Promise.race<boolean>([
    navigator.clipboard.writeText(text).then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}
