// Which files the Privatemode backend will accept, and why it won't accept the rest.
// Pure: no DOM, no network. Every branch here is table-tested in test/gate.test.ts.

// https://docs.privatemode.ai/reference/speech-to-text/
export const FORMATS = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm'] as const;
export type Format = (typeof FORMATS)[number];
export const MAX_BYTES = 50 * 1024 * 1024;

/** How many leading bytes sniffContainer() needs to make up its mind. */
export const SNIFF_BYTES = 64;

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const mb = (bytes: number): string => (bytes / 1048576).toFixed(1);
const listed = (list: readonly string[], ext: string): boolean => list.includes(ext);

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

/**
 * Which accepted container the first bytes belong to, or null when they belong
 * to none. An extension names what the sender called the file; the magic
 * number names what it is. `.opus` (a WhatsApp voice note) is an Ogg file,
 * `.oga` too, `.weba` is WebM — all containers the API accepts under the name
 * it knows them by, so the bytes can be sent untouched.
 *
 * Deliberately narrow: only signatures that identify a container in the accepted
 * list, and nothing that guesses. Matroska shares its EBML header with WebM and
 * is *not* accepted, so the DocType has to say "webm". Raw MPEG audio without an
 * ID3 tag starts with a frame-sync pattern that random bytes also match roughly
 * once in 2048 tries, which is far too often for a gate; those files keep their
 * extension check.
 */
export function sniffContainer(head: Uint8Array): Format | null {
  if (head.length < 12) return null;
  const tag4 = ascii(head, 0, 4);
  if (tag4 === 'OggS') return 'ogg';
  if (tag4 === 'fLaC') return 'flac';
  if (tag4 === 'RIFF' && ascii(head, 8, 12) === 'WAVE') return 'wav';
  if (ascii(head, 0, 3) === 'ID3') return 'mp3';
  if (ascii(head, 4, 8) === 'ftyp') return ascii(head, 8, 11) === 'M4A' ? 'm4a' : 'mp4';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    // EBML. The DocType string sits inside the header, within the first few dozen bytes.
    return ascii(head, 4, head.length).includes('webm') ? 'webm' : null;
  }
  return null;
}

export type Verdict =
  /** `sendAs`, when present, is the name to hand the API: the extension lied about the container. */
  | { ok: true; sendAs?: string }
  | { ok: false; reason: 'format' | 'size' | 'empty'; why: string };

/**
 * Admit, relabel, or reject. `head` is the file's first SNIFF_BYTES bytes; with
 * it, a file whose extension is not on the list but whose bytes are an accepted
 * container passes under the container's name. Without it, the extension decides.
 *
 * An accepted extension is never second-guessed: sniffing is a rescue for names
 * the API would refuse, not a lie detector for names it would take.
 */
export function gate({ name, size }: Pick<File, 'name' | 'size'>, head?: Uint8Array): Verdict {
  const ext = extensionOf(name);
  let sendAs: string | undefined;
  if (!listed(FORMATS, ext)) {
    const container = head ? sniffContainer(head) : null;
    if (!container) {
      return {
        ok: false,
        reason: 'format',
        why: ext
          ? `.${ext} is not a supported format. Re-encoding arrives in stage 2.`
          : 'That file has no extension, so its format cannot be determined.',
      };
    }
    sendAs = `${ext ? name.slice(0, name.length - ext.length - 1) : name}.${container}`;
  }
  // Zero bytes passes both other checks and fails confusingly at the API instead.
  if (size === 0) return { ok: false, reason: 'empty', why: 'That file is empty.' };
  if (size > MAX_BYTES) {
    return {
      ok: false,
      reason: 'size',
      why: `${mb(size)} MB is over the 50 MB limit. Re-encoding arrives in stage 2.`,
    };
  }
  return sendAs ? { ok: true, sendAs } : { ok: true };
}

// Formats the browser can play back inline. A file can be transcribable but not
// playable (mpga), so the result card must not assume a working player.
//
// There is deliberately no isVideo() here. mp4, webm and ogg are containers that
// may hold audio only, so the extension cannot tell you whether to render <video>
// or <audio> — media.ts probes the file itself.
const PLAYABLE = ['mp3', 'mp4', 'm4a', 'ogg', 'wav', 'webm', 'flac'] as const;

export const isPlayable = (name: string): boolean => listed(PLAYABLE, extensionOf(name));
