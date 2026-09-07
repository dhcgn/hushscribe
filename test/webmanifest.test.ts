import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * public/manifest.webmanifest and public/sw.js are static assets: no bundler
 * touches them, no unit elsewhere imports them, and a typo in either is only
 * visible on an installed Android PWA. These are the two couplings that cannot
 * be caught any other way — the share target's URL, and the form field name the
 * worker reads out of the POST.
 */
const read = (p: string): string => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

/** Only the fields these tests read; the manifest carries more. */
interface WebManifest {
  start_url: string;
  scope: string;
  share_target: {
    action: string;
    method: string;
    enctype: string;
    params: { files: { name: string; accept: string[] }[] };
  };
}

const manifest = JSON.parse(read('manifest.webmanifest')) as WebManifest;
const sw = read('sw.js');
const share = manifest.share_target;
const files = share.params.files[0];
if (!files) throw new Error('share_target declares no file parameter');

describe('share target declaration', () => {
  it('posts a multipart form, which is the only shape that can carry a file', () => {
    expect(share.method).toBe('POST');
    expect(share.enctype).toBe('multipart/form-data');
  });

  it('accepts every container the gate does, audio-only or not', () => {
    // .mp4/.webm/.ogg are shared with a video/* type even when they hold audio
    // only, and the gate takes them, so refusing them here would hide the app
    // from the share sheet for files it can actually transcribe.
    expect(files.accept).toEqual(['audio/*', 'video/*']);
  });

  it('names the form field the worker actually reads', () => {
    expect(sw).toContain(`getAll('${files.name}')`);
  });
});

describe('every manifest URL is relative', () => {
  // The site is served from /hushscribe/, and every PR preview from
  // /hushscribe/pr/<n>/. A root-absolute "/share-target" — the shape most
  // examples show — resolves outside the manifest's scope on both, and the
  // browser drops the share target entirely without saying why.
  it.each([
    ['start_url', manifest.start_url],
    ['scope', manifest.scope],
    ['share_target.action', share.action],
  ])('%s stays inside the deployed sub-path', (_name, value) => {
    expect(value.startsWith('/')).toBe(false);
    expect(value).not.toMatch(/^[a-z]+:/i);

    const preview = 'https://dhcgn.github.io/hushscribe/pr/42/';
    expect(new URL(value, `${preview}manifest.webmanifest`).href).toMatch(
      new RegExp(`^${preview}`),
    );
  });
});
