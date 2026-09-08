import type { Manifest } from 'privatemode-ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientFactory, TranscriptionClient } from '../src/client';
import { digestHex } from '../src/manifest';
import { createSession } from '../src/session';

const MEASUREMENT = 'ab'.repeat(48);
const MANIFEST: Manifest = {
  ReferenceValues: {
    snp: [{
      ProductName: 'Genoa', TrustedMeasurement: MEASUREMENT,
      MinimumTCB: { BootloaderVersion: 4, TEEVersion: 0, SNPVersion: 22, MicrocodeVersion: 213 },
      GuestPolicy: { SMT: true, MigrateMA: false, Debug: false, CXLAllowed: false, PageSwapDisable: false },
      PlatformInfo: { SMTEnabled: true, ECCEnabled: false, AliasCheckComplete: true },
      AllowedChipIDs: [],
    }],
  },
};
const BYTES = new TextEncoder().encode(JSON.stringify(MANIFEST));
const BASE = { dangerouslyAllowBrowser: true, browserWasmURL: '/x.wasm', expectedWasmHash: 'f'.repeat(64) };

interface FakeOptions {
  manifest?: Manifest;
  bytes?: Uint8Array | null;
  verifyError?: Error;
  refreshError?: Error;
}

/** A client that does what the fake in test/e2e does, with hooks to fail. */
function fakeClient(o: FakeOptions = {}) {
  const verify = vi.fn(async () => {
    if (o.verifyError) throw o.verifyError;
    return { manifest: o.manifest ?? MANIFEST };
  });
  const refreshSecret = vi.fn(async () => {
    if (o.refreshError) throw o.refreshError;
  });
  const client: TranscriptionClient = {
    verify,
    refreshSecret,
    manifestBytes: o.bytes === undefined ? BYTES : o.bytes,
    audio: { transcriptions: { create: async () => ({ text: '' }) } },
  };
  return { client, verify, refreshSecret };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('verify', () => {
  it('opens a session stamped with the SNP measurement and the manifest digest', async () => {
    const { client } = fakeClient();
    const make = vi.fn<ClientFactory>(() => client);
    const session = createSession(make, BASE, () => {});

    const sealed = await session.verify('pm-key');

    expect(make).toHaveBeenCalledWith({ ...BASE, apiKey: 'pm-key' });
    expect(sealed.measurement).toBe(MEASUREMENT);
    expect(sealed.manifestDigest).toBe(await digestHex(BYTES));
    expect(session.client).toBe(client);
    expect(session.measurement).toBe(MEASUREMENT);
  });

  it('falls back to the manifest digest when there are no SNP values', async () => {
    const { client } = fakeClient({ manifest: {} });
    const session = createSession(() => client, BASE, () => {});
    const sealed = await session.verify('k');
    expect(sealed.measurement).toBe(`manifest ${await digestHex(BYTES)}`);
  });

  it('stamps nothing rather than something made up when there is neither', async () => {
    const { client } = fakeClient({ manifest: {}, bytes: null });
    const session = createSession(() => client, BASE, () => {});
    const sealed = await session.verify('k');
    expect(sealed.measurement).toBe('');
    expect(sealed.manifestDigest).toBeNull();
  });

  it('rejects and leaves no client behind when attestation fails', async () => {
    const { client } = fakeClient({ verifyError: new Error('attestation rejected') });
    const session = createSession(() => client, BASE, () => {});
    await expect(session.verify('k')).rejects.toThrow('attestation rejected');
    expect(session.client).toBeNull();
    expect(session.measurement).toBe('');
  });

  it('shares a verification already in flight instead of starting a second one', async () => {
    const { client } = fakeClient();
    const make = vi.fn<ClientFactory>(() => client);
    const session = createSession(make, BASE, () => {});
    const [a, b] = await Promise.all([session.verify('k'), session.verify('k')]);
    expect(a).toBe(b);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('verifies afresh once the previous attempt has settled', async () => {
    const { client } = fakeClient();
    const make = vi.fn<ClientFactory>(() => client);
    const session = createSession(make, BASE, () => {});
    await session.verify('k');
    await session.verify('k');
    expect(make).toHaveBeenCalledTimes(2);
  });
});

describe('the refresh timer', () => {
  it('keeps the secret fresh while the session is open', async () => {
    const { client, refreshSecret } = fakeClient();
    const session = createSession(() => client, BASE, () => {}, 1000);
    await session.verify('k');
    await vi.advanceTimersByTimeAsync(2500);
    expect(refreshSecret).toHaveBeenCalledTimes(2);
  });

  it('stops when the session ends — a forgotten key must not keep calling the API', async () => {
    const { client, refreshSecret } = fakeClient();
    const session = createSession(() => client, BASE, () => {}, 1000);
    await session.verify('k');
    session.end();
    await vi.advanceTimersByTimeAsync(5000);
    expect(refreshSecret).not.toHaveBeenCalled();
    expect(session.client).toBeNull();
    expect(session.measurement).toBe('');
  });

  it('reports a lost channel instead of failing silently', async () => {
    const { client } = fakeClient({ refreshError: new Error('secret expired') });
    const onRefreshError = vi.fn();
    const session = createSession(() => client, BASE, onRefreshError, 1000);
    await session.verify('k');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRefreshError).toHaveBeenCalledWith(new Error('secret expired'));
  });

  it('wraps a non-Error rejection so the message is always readable', async () => {
    const client: TranscriptionClient = {
      ...fakeClient().client,
      refreshSecret: () => Promise.reject('plain string'),
    };
    const onRefreshError = vi.fn();
    const session = createSession(() => client, BASE, onRefreshError, 1000);
    await session.verify('k');
    await vi.advanceTimersByTimeAsync(1000);
    expect(onRefreshError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onRefreshError.mock.calls[0]?.[0]).toHaveProperty('message', 'plain string');
  });
});

describe('end during verification', () => {
  it('discards a verification that finishes after the session was ended', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const { client } = fakeClient();
    const slow: TranscriptionClient = {
      ...client,
      verify: async () => { await gate; return { manifest: MANIFEST }; },
    };
    const session = createSession(() => slow, BASE, () => {}, 1000);

    const attempt = session.verify('k');
    session.end();
    release?.();
    await expect(attempt).rejects.toThrow(/ended/);
    expect(session.client).toBeNull();
  });
});
