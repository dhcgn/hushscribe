// The attested session: one verified client, the enclave measurement every
// transcript is stamped with, and the timer that keeps the encryption secret
// fresh. DOM-free, so the one thing an end-to-end test cannot observe — a
// five-minute timer outliving "Forget key" — is checked with fake timers in
// test/session.test.ts.
//
// Receives the client options rather than building them: import.meta.env and
// the build-time defines are invisible to the Node test project (AGENT.md).

import type { Manifest, PrivatemodeAIOptions } from 'privatemode-ai';
import type { ClientFactory, TranscriptionClient } from './client';
import { digestHex, measurements } from './manifest';

export interface Sealed {
  manifest: Manifest;
  /** SHA-256 of the raw manifest bytes, or null when the client exposed none. */
  manifestDigest: string | null;
  /** The chain-of-custody stamp: the SNP launch measurement, else the manifest digest. */
  measurement: string;
}

export interface Session {
  /** The verified client, or null before verification and after end(). */
  readonly client: TranscriptionClient | null;
  readonly measurement: string;
  /**
   * Attest and open the channel. Rejects (after end()) when attestation fails.
   * A verification already in flight is shared, not repeated: a file dropped
   * while the page attests on load must not start a second handshake.
   */
  verify(apiKey: string): Promise<Sealed>;
  /**
   * Close the session: drop the client, forget the measurement, stop refreshing.
   * Forgetting a credential has to end the session it opened — otherwise the
   * refresh timer keeps calling the API with a key the user just deleted.
   */
  end(): void;
}

// ponytail: fixed interval, not expiresAtUnix-driven. Revisit if a refresh is
// ever actually missed.
const REFRESH_MS = 5 * 60_000;

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export function createSession(
  make: ClientFactory,
  base: Omit<PrivatemodeAIOptions, 'apiKey'>,
  onRefreshError: (e: Error) => void,
  refreshMs = REFRESH_MS,
): Session {
  let client: TranscriptionClient | null = null;
  let measurement = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending: Promise<Sealed> | null = null;
  // Bumped by end(): a verification that finishes after the session it belongs
  // to was ended must not resurrect it.
  let generation = 0;

  const end = (): void => {
    generation += 1;
    pending = null;
    client = null;
    measurement = '';
    clearInterval(timer);
    timer = undefined;
  };

  const attest = async (apiKey: string, gen: number): Promise<Sealed> => {
    const next = make({ ...base, apiKey });
    try {
      const { manifest } = await next.verify();
      const manifestDigest = await digestHex(next.manifestBytes);
      if (gen !== generation) throw new Error('session ended during verification');

      measurement =
        measurements(manifest)[0]?.measurement ?? (manifestDigest ? `manifest ${manifestDigest}` : '');
      client = next;
      timer = setInterval(() => {
        next.refreshSecret().catch((e: unknown) => onRefreshError(toError(e)));
      }, refreshMs);
      return { manifest, manifestDigest, measurement };
    } catch (e) {
      if (gen === generation) end();
      throw e;
    } finally {
      if (gen === generation) pending = null;
    }
  };

  return {
    get client() {
      return client;
    },
    get measurement() {
      return measurement;
    },
    verify(apiKey) {
      pending ??= attest(apiKey, generation);
      return pending;
    },
    end,
  };
}
