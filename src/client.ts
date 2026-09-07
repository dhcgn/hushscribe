// The one seam between hushscribe and the Privatemode SDK — and the only
// test-facing hook in shipped code (ARCHITECTURE.md §6.2).
//
// The interface below is what the app needs from a client, derived from the
// SDK's own declarations and OpenAI's transcription types. Playwright injects a
// stand-in through `globalThis.__HC_CLIENT` (test/e2e/fake-client.ts), and that
// fake has to compile against this very interface. So a fake that invents a
// field the real API does not have — the mistake that once shipped `✓(manifes`
// to users — is now a type error rather than a green test.

import type { Transcription } from 'openai/resources/audio/transcriptions';
import { PrivatemodeAI, type PrivatemodeAIOptions, type VerifyResult } from 'privatemode-ai';
import type { Segment } from './types';

export interface TranscribeRequest {
  model: string;
  file: File;
  language?: string;
  prompt?: string;
  /** verbose_json carries the segments; the API accepts it only with a language. */
  response_format: 'json' | 'verbose_json';
}

/**
 * What hushscribe reads off a transcription response: the text, and the
 * segments when verbose_json was asked for. Narrowed from the OpenAI types so
 * nothing downstream has to carry (or invent) log-probabilities and token arrays.
 */
export type TranscriptionResult = Pick<Transcription, 'text'> & { segments?: Segment[] };

export interface TranscriptionClient {
  verify(): Promise<VerifyResult>;
  refreshSecret(): Promise<void>;
  /** The raw bytes the SDK verified; hashed for display, never re-serialised. */
  readonly manifestBytes: Uint8Array | null;
  readonly audio: {
    readonly transcriptions: {
      create(req: TranscribeRequest): Promise<TranscriptionResult>;
    };
  };
}

export type ClientFactory = (opts: PrivatemodeAIOptions) => TranscriptionClient;

declare global {
  // `var`, not `let`: only a var declaration becomes a property of globalThis.
  // eslint-disable-next-line no-var
  var __HC_CLIENT: ClientFactory | undefined;
}

/**
 * The real thing. Typing this factory as a ClientFactory is the compile-time
 * proof that the SDK satisfies the seam: if a future SDK release changes the
 * shape, this line stops compiling before anything ships.
 */
const real: ClientFactory = (opts) => new PrivatemodeAI(opts);

/** Fakes live only in test/e2e/, so no mock code ever reaches the bundle. */
export const makeClient: ClientFactory = globalThis.__HC_CLIENT ?? real;
