// Re-encode fallback for files the gate rejects.
//
// Triggered only when gate() says no (foreign container or > 50 MB). Lazy
// `import('./reencode')`, so users who never need it never download ffmpeg
// (ARCHITECTURE.md §4). Single-threaded @ffmpeg/core only: GitHub Pages sets
// no COOP/COEP headers, so SharedArrayBuffer (@ffmpeg/core-mt) is unavailable,
// and the coi-serviceworker workaround is rejected as third-party code with
// full page access (§1.2). Runs in a Worker internally, so the UI stays
// responsive.
//
// This module deliberately touches neither import.meta.env nor any build-time
// define: a unit test imports the pure helpers below, and those exist only in
// the browser project (AGENT.md). The caller (transcribe.ts, DOM wiring that
// Playwright covers) builds the same-origin core URLs and passes them in.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { MAX_BYTES } from './gate';

/** Two attempts, then stop. Past 64 kbit/s the 1-hour decode limit binds, not
 *  the size limit, so more compression cannot help (§4, §9). */
export const REENCODE_BITRATES = [128, 64] as const;
export type ReencodeBitrate = (typeof REENCODE_BITRATES)[number];

/** mp3 128 kbit/s mono holds ~52 minutes under the 50 MB request limit. */
export const fitsAfterReencode = (bytes: number): boolean => bytes <= MAX_BYTES;

/** interview.mkv -> interview.mp3. The card keeps the dropped name; this is
 *  the name the API sees. */
export const reencodedName = (name: string): string => {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem || 'audio'}.mp3`;
};

/** input. + the original extension, so the demuxer gets a hint about the
 *  container. Falls back to plain `input` when there is no extension. */
export const inputNameFor = (name: string): string => {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `input.${ext}` : 'input';
};

let ffmpeg: FFmpeg | null = null;
let loaded = false;

/**
 * Load the vendored single-threaded core (same-origin, never a CDN — it
 * touches plaintext audio, §1.2). Direct same-origin URLs, not blob URLs: the
 * worker imports the core with a dynamic import(), and script-src 'self'
 * already allows that, while blob: would need a wider CSP for no gain.
 */
export async function ensureFFmpeg(coreURL: string, wasmURL: string): Promise<FFmpeg> {
  if (ffmpeg && loaded) return ffmpeg;
  ffmpeg ??= new FFmpeg();
  if (!loaded) {
    await ffmpeg.load({ coreURL, wasmURL });
    loaded = true;
  }
  return ffmpeg;
}

/** Test seam: drop the singleton so a fresh load can be observed. */
export function __resetFFmpegForTests(): void {
  ffmpeg = null;
  loaded = false;
}

/**
 * Extract the audio track and re-encode it to mp3 mono at `bitrateKbps`.
 * Video tracks are discarded (-vn). Throws with a readable message when
 * ffmpeg cannot decode the file.
 */
export async function reencode(
  file: File,
  bitrateKbps: ReencodeBitrate,
  coreURL: string,
  wasmURL: string,
): Promise<File> {
  const ff = await ensureFFmpeg(coreURL, wasmURL);
  const inName = inputNameFor(file.name);
  const outName = 'output.mp3';
  try {
    await ff.writeFile(inName, await fetchFile(file));
  } catch (e) {
    throw new Error(`Could not read ${file.name}: ${message(e)}`);
  }
  // A previous attempt's output must not survive into this one.
  try {
    await ff.deleteFile(outName);
  } catch {
    /* absent — the normal case */
  }
  let code = 1;
  try {
    code = await ff.exec(['-i', inName, '-vn', '-ac', '1', '-b:a', `${bitrateKbps}k`, outName]);
  } finally {
    try {
      await ff.deleteFile(inName);
    } catch {
      /* best effort */
    }
  }
  if (code !== 0) {
    try {
      await ff.deleteFile(outName);
    } catch {
      /* best effort */
    }
    throw new Error(
      `Could not re-encode ${file.name}. The file may be corrupt or use a codec this browser build cannot decode.`,
    );
  }
  const data = await ff.readFile(outName);
  try {
    await ff.deleteFile(outName);
  } catch {
    /* best effort */
  }
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new File([new Uint8Array(bytes)], reencodedName(file.name), { type: 'audio/mpeg' });
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
