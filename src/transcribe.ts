// From a File to a result card: gate, probe, price, send, render, remember.

import { cardHead, exportBar, segmentList } from './card';
import type { TranscriptionResult } from './client';
import { $, el, messageOf, note } from './dom';
import { MAX_BYTES, SNIFF_BYTES, extensionOf, gate, isPlayable } from './gate';
import { pushHistory } from './history';
import { shortHex } from './manifest';
import { ownUrl, probeMedia } from './media';
import { PRICES_DATED, estimateLine } from './pricing';
import { session, verifyKey } from './proof';
import { toTXT, toVTT } from './segments';
import { collectShared } from './share';
import type { Segment } from './types';

/**
 * Transcribe every file, one after another: honest progress, no rate-limit
 * games, less code. Attests first when the page has not yet — dropping a file
 * is an unambiguous request, so do the verification the user would otherwise
 * have had to click through.
 */
export async function take(files: FileList | readonly File[]): Promise<void> {
  // Snapshot before any await: a FileList is live, and the picker's change
  // handler clears picker.value the moment this returns — which empties the
  // list out from under us once this function starts awaiting verification.
  const queue = [...files];
  if (!queue.length) return;

  if (!session.client) {
    if (!$('key').value.trim()) {
      note($('keyNote'), 'Enter your API key first, then drop the file again.', true);
      $('key').focus();
      return;
    }
    if (!(await verifyKey())) return; // verifyKey has already explained why
  }
  for (const file of queue) await transcribe(file);
}

async function transcribe(dropped: File): Promise<void> {
  const card = el('article', { className: 'card' });
  $('results').prepend(card);

  // The extension says what the sender called the file; the first bytes say what
  // it is. A WhatsApp voice note is `.opus` by name and an Ogg file by content,
  // and Ogg is on the list — so it goes through under the name the API knows,
  // bytes untouched. Anything else the gate rejects goes to the re-encode fallback below.
  const verdict = gate(dropped, new Uint8Array(await dropped.slice(0, SNIFF_BYTES).arrayBuffer()));
  if (!verdict.ok && verdict.reason === 'empty') {
    card.classList.add('bad');
    card.append(
      cardHead(dropped.name).head,
      el('p', { className: 'note warn', textContent: verdict.why }),
    );
    return;
  }

  // The card, the exports and history all keep the name the user knows.
  let file = verdict.ok && verdict.sendAs
    ? new File([dropped], verdict.sendAs, { type: dropped.type })
    : dropped;
  let reencodedFrom: string | null = null;
  const { head, chain } = cardHead(dropped.name);

  if (!verdict.ok) {
    // Re-encode fallback. Triggered only when the gate rejects
    // (foreign container or > 50 MB). Lazy import, so users who never need it
    // never download ffmpeg (§4).
    chain.append(el('span', { className: 'spin' }), ' re-encoding in your browser');
    card.append(head);
    const fallback = await reencodeFallback(dropped, chain);
    if (!fallback.ok) {
      card.classList.add('bad');
      chain.textContent = `Failed: ${fallback.why}`;
      card.append(el('p', { className: 'note warn', textContent: fallback.why }));
      return;
    }
    file = fallback.file;
    reencodedFrom = fallback.note;
    chain.replaceChildren(el('span', { className: 'spin' }), ' transcribing');
  } else {
    chain.append(el('span', { className: 'spin' }), ' transcribing');
    card.append(head);
    if (verdict.sendAs) {
      card.append(el('p', {
        className: 'note',
        textContent: `Sent as ${verdict.sendAs}. The API does not list this extension, but the bytes are a .${extensionOf(file.name)} file, which it does. Same bytes, only the name changes.`,
      }));
    }
  }
  if (reencodedFrom) {
    card.append(el('p', { className: 'note', textContent: reencodedFrom }));
  }

  // Ask the file what it contains. .webm, .mp4 and .ogg are containers that may
  // hold audio only, so the extension cannot decide between <video> and <audio> —
  // guessing wrong paints an empty black viewport above the controls.
  const probe = await probeMedia(file);

  // A file can be transcribable but not playable (mpga), so never assume a player.
  let media: HTMLMediaElement | null = null;
  if (isPlayable(file.name)) {
    media = el(probe.hasVideo ? 'video' : 'audio', {
      src: ownUrl(URL.createObjectURL(file)),
      controls: true,
    });
    card.append(media);
  }

  const model = $('model').value;
  // Billing is per audio minute, so the cost is knowable as soon as the browser
  // has read the duration — long before the transcript comes back. No duration
  // means no honest estimate, so say nothing at all.
  const line = estimateLine(probe.duration, model);
  if (line) {
    card.append(el('p', { className: 'price', textContent: `${line} · estimate, ${PRICES_DATED} prices` }));
  }

  const fail = (why: string): void => {
    card.classList.add('bad');
    chain.textContent = `Failed: ${why}`;
  };

  // The session can end while the probe above was running ("Forget key").
  const client = session.client;
  if (!client) return fail('the session ended before this file was sent');

  // Timestamps come from verbose_json, which the API accepts only alongside a
  // language. No language → plain text. Degrade, don't demand. (§3.3)
  const lang = $('lang').value;
  const prompt = $('prompt').value.trim();
  let res: TranscriptionResult;
  try {
    res = await client.audio.transcriptions.create({
      model,
      file,
      ...(lang ? { language: lang } : {}),
      ...(prompt ? { prompt } : {}),
      response_format: lang ? 'verbose_json' : 'json',
    });
  } catch (e) {
    return fail(messageOf(e));
  }

  const segments = res.segments?.length ? res.segments : null;
  const text = segments ? toTXT(segments) : (res.text ?? '');
  const measurement = session.measurement;
  renderResult({ card, chain, media, file: dropped, lang, measurement, segments, text });

  // Ephemeral mode stops here. The card stays on screen for as long as this tab
  // is open; nothing about it reaches disk. The guard is on the write, not the
  // render, because a transcript that was never stored cannot leak from storage.
  if ($('ephemeral').checked) return;

  pushHistory({
    name: dropped.name,
    model,
    lang: lang || 'auto',
    at: new Date().toISOString(),
    measurement,
    text,
    segments,
  });
}

interface Result {
  card: HTMLElement;
  chain: HTMLElement;
  media: HTMLMediaElement | null;
  file: File;
  lang: string;
  measurement: string;
  segments: Segment[] | null;
  text: string;
}

/** Fill a card with a finished transcript: the stamp, the text, the exports. */
function renderResult({ card, chain, media, file, lang, measurement, segments, text }: Result): void {
  // Git-style: enough to recognise, short enough not to dominate the card.
  chain.textContent = shortHex(measurement, 12);
  chain.title = measurement;

  // Redo re-runs this same file with whatever model, language, and prompt are
  // selected *now* — the usual reason being a wrong language. Only offered here,
  // never in history, because history keeps text and never the media (§5.3).
  const redo = el('button', {
    textContent: 'Redo',
    title: 'Transcribe this file again with the settings currently selected above',
  });
  redo.dataset['act'] = 'redo';
  redo.addEventListener('click', () => { void take([file]); });

  if (!segments) {
    card.append(
      el('p', { className: 'plain', textContent: text }),
      exportBar(file.name, null, redo, text),
      el('p', { className: 'note', textContent: 'Set a language to get timestamps and captions.' }),
    );
    return;
  }

  if (media) {
    // The browser renders the captions; we only hand it a VTT blob.
    media.append(el('track', {
      src: ownUrl(URL.createObjectURL(new Blob([toVTT(segments)], { type: 'text/vtt' }))),
      default: true,
      kind: 'captions',
      srclang: lang,
      label: lang,
    }));
  }
  card.append(segmentList(segments, media), exportBar(file.name, segments, redo));
}

type Fallback = { ok: true; file: File; note: string } | { ok: false; why: string };

/**
 * Re-encode fallback: extract the audio track and re-encode to mp3 mono, first
 * at 128 kbit/s, then at 64 kbit/s. Two attempts cover the realistic range;
 * past 64 kbit/s the 1-hour decode limit binds instead of the size limit, so
 * more compression cannot help (§4). The last branch cannot be fixed by more
 * compression — it needs splitting on silence (§9).
 */
async function reencodeFallback(dropped: File, chain: HTMLElement): Promise<Fallback> {
  const base = import.meta.env.BASE_URL;
  const coreURL = `${base}ffmpeg-core.js`;
  const wasmURL = `${base}ffmpeg-core.wasm`;
  let mod: typeof import('./reencode');
  try {
    mod = await import('./reencode');
  } catch (e) {
    return { ok: false, why: `Could not load the re-encoder: ${messageOf(e)}` };
  }
  const { reencode, REENCODE_BITRATES: bitrates } = mod;
  for (const kbps of bitrates) {
    let out: File;
    try {
      out = await reencode(dropped, kbps, coreURL, wasmURL);
    } catch (e) {
      return { ok: false, why: messageOf(e) };
    }
    if (out.size <= MAX_BYTES && out.size > 0) {
      const mb = (out.size / 1048576).toFixed(1);
      return {
        ok: true,
        file: out,
        note: `Re-encoded in your browser to mp3 ${kbps} kbit/s mono (${mb} MB) and sent as ${out.name}. The original file never left your device; only the re-encoded audio was encrypted and sent.`,
      };
    }
    chain.replaceChildren(el('span', { className: 'spin' }), ` re-encoding at 64 kbit/s`);
  }
  return {
    ok: false,
    why: 'Still over the 50 MB limit after re-encoding at 64 kbit/s. Split the recording into parts under an hour and transcribe them in order.',
  };
}

/**
 * A file shared from the Android share sheet is waiting in the service worker's
 * memory (§5.6). Fetch it and treat it exactly like a dropped one.
 */
export async function takeShared(): Promise<void> {
  if (!new URLSearchParams(location.search).has('shared')) return;
  // Drop the marker first, whatever happens below: a reload must not announce a
  // second time that a file went missing.
  history.replaceState(null, '', location.pathname);

  const files = await collectShared(navigator.serviceWorker?.controller);
  if (files.length) return take(files);

  // Losing the file is rare and never silent. Saying nothing at all would look
  // exactly like a share sheet that had picked the wrong app.
  const card = el('article', { className: 'card bad' });
  card.append(el('p', {
    className: 'note warn',
    textContent: 'The shared file did not reach the page. Share it again, or drop it here.',
  }));
  $('results').prepend(card);
}
