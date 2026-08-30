// Which files the Privatemode backend will accept, and why it won't accept the rest.
// Pure: no DOM, no network. Every branch here is table-tested in test/gate.test.js.

// https://docs.privatemode.ai/reference/speech-to-text/
export const FORMATS = ['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'wav', 'webm'];
export const MAX_BYTES = 50 * 1024 * 1024;

export const extensionOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

const mb = (bytes) => (bytes / 1048576).toFixed(1);

/**
 * @returns {{ok: true} | {ok: false, reason: 'format'|'size'|'empty', why: string}}
 */
export function gate({ name, size }) {
  const ext = extensionOf(name);
  if (!FORMATS.includes(ext)) {
    return {
      ok: false,
      reason: 'format',
      why: ext
        ? `.${ext} is not a supported format. Re-encoding arrives in stage 2.`
        : 'That file has no extension, so its format cannot be determined.',
    };
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
  return { ok: true };
}

// Formats the browser can play back inline. A file can be transcribable but not
// playable (mpga), so the result card must not assume a working player.
//
// There is deliberately no isVideo() here. mp4, webm and ogg are containers that
// may hold audio only, so the extension cannot tell you whether to render <video>
// or <audio> — app.js probes the file itself.
const PLAYABLE = ['mp3', 'mp4', 'm4a', 'ogg', 'wav', 'webm', 'flac'];

export const isPlayable = (name) => PLAYABLE.includes(extensionOf(name));
