// In-browser recording: pick a container the gate accepts, name the file,
// measure mic level, and draw the live amplitude trace. MediaRecorder and
// getUserMedia stay with the caller; everything here is pure or canvas-only
// so it unit-tests without a microphone.

/** Candidates in preference order — each extension is on the gate's list. */
export const MIME_CANDIDATES = [
  { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
  { mimeType: 'audio/webm', ext: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
  { mimeType: 'audio/ogg', ext: 'ogg' },
  { mimeType: 'audio/mp4', ext: 'm4a' },
] as const;

export interface RecordingTarget {
  mimeType: string;
  ext: string;
}

/**
 * First candidate the browser claims to support. Falls back to the browser
 * default named .webm — the gate never second-guesses an accepted extension,
 * so a mismatched default still passes intake instead of failing here.
 */
export function pickRecordingTarget(
  isSupported: (mimeType: string) => boolean,
): RecordingTarget {
  for (const c of MIME_CANDIDATES) {
    try {
      if (isSupported(c.mimeType)) return { mimeType: c.mimeType, ext: c.ext };
    } catch {
      /* treat as unsupported and keep looking */
    }
  }
  return { mimeType: '', ext: 'webm' };
}

/** recording-20261114-0930.webm — sortable, and the extension names the container. */
export function recordingFileName(ext: string, now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `recording-${stamp}.${ext}`;
}

/**
 * Mic level 0..1 from byte time-domain samples (128 = silence). RMS, so a
 * single spike does not read as signal. Anything above ~0.02 is a live mic.
 */
export function meterLevel(data: Uint8Array | Uint8ClampedArray): number {
  if (!data.length) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = ((data[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / data.length) * 2);
}

/** Format elapsed ms as m:ss for the recording timer. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface Meter {
  /** Stop the animation loop and release the analyser graph. */
  stop: () => void;
}

/**
 * Draw the live amplitude trace of `source` onto `canvas` until stopped.
 * Local-only visualisation — no audio data leaves this callback.
 * With reduced motion, draws a slow level bar instead of a scrolling trace.
 */
export function startMeter(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  canvas: HTMLCanvasElement,
  onLevel?: (level: number) => void,
): Meter {
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const data = new Uint8Array(analyser.fftSize);
  const g = canvas.getContext('2d');
  if (!g) return { stop: () => source.disconnect(analyser) };

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fg = getComputedStyle(canvas).color || '#1f3bc4';
  const axis = getComputedStyle(document.documentElement).getPropertyValue('--rule').trim() || '#c9ced6';
  let raf = 0;
  let last = 0;

  // Scrolling history: one peak per frame, newest at the right edge. The user
  // sees loudness over time, not a single instant frozen across the width.
  const cols = Math.max(64, canvas.width);
  const hist = new Float32Array(cols);

  const drawWave = (): void => {
    raf = requestAnimationFrame(drawWave);
    analyser.getByteTimeDomainData(data);
    onLevel?.(meterLevel(data));
    let peak = 0;
    for (let i = 0; i < data.length; i += 2) {
      const v = Math.abs(((data[i] ?? 128) - 128) / 128);
      if (v > peak) peak = v;
    }
    hist.copyWithin(0, 1);
    hist[cols - 1] = Math.min(1, peak);
    const { width: w, height: h } = canvas;
    const mid = Math.round(h / 2) + 0.5; // crisp 1px line
    g.clearRect(0, 0, w, h);
    g.fillStyle = axis;
    g.fillRect(0, mid, w, 1);
    g.fillStyle = fg;
    for (let x = 0; x < cols; x++) {
      const bar = (hist[x] ?? 0) * (mid - 2);
      if (bar < 1) continue;
      g.fillRect(x, mid - bar, 1, bar * 2);
    }
  };

  const drawBar = (now: number): void => {
    raf = requestAnimationFrame(drawBar);
    if (now - last < 500) return; // 2 Hz is enough when motion is reduced
    last = now;
    analyser.getByteTimeDomainData(data);
    const level = meterLevel(data);
    onLevel?.(level);
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = fg;
    g.fillRect(0, 0, Math.round(w * level), h);
  };

  raf = requestAnimationFrame(reduced ? drawBar : drawWave);
  return {
    stop: () => {
      cancelAnimationFrame(raf);
      source.disconnect(analyser);
    },
  };
}
