import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  digestHex, measurements, policySummary, proofSummary, shortHex,
} from '../src/manifest.js';

// A genuine manifest, fetched from https://cdn.confidential.cloud/privatemode/v2/manifest.json.
// The bug this module exists to fix came from inventing the manifest's shape and
// having a fake agree with the invention, so these tests read the real thing.
const BYTES = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'manifest.json'));
const REAL = JSON.parse(BYTES.toString('utf8'));

describe('the real manifest', () => {
  it('has no digest field — the assumption that caused the bug', () => {
    expect('digest' in REAL).toBe(false);
    expect(REAL.digest).toBeUndefined();
  });

  it('carries exactly the three documented top-level keys', () => {
    expect(Object.keys(REAL).sort()).toEqual(['Policies', 'ReferenceValues', 'SeedshareOwnerPubKeys']);
  });
});

describe('measurements', () => {
  it('extracts the SNP launch measurement and its product', () => {
    const [first] = measurements(REAL);
    expect(first.product).toBe('Genoa');
    // A SEV-SNP measurement is 48 bytes -> 96 hex characters.
    expect(first.measurement).toMatch(/^[0-9a-f]{96}$/);
  });

  it.each([undefined, null, {}, { ReferenceValues: {} }, { ReferenceValues: { snp: [] } }])(
    'returns an empty list for %j rather than throwing',
    (input) => expect(measurements(input)).toEqual([]),
  );

  it('skips entries with no measurement', () => {
    expect(measurements({ ReferenceValues: { snp: [{ ProductName: 'Milan' }] } })).toEqual([]);
  });
});

describe('proofSummary', () => {
  it('reads "Genoa · ea6a6655" style for a real manifest', () => {
    const line = proofSummary(REAL, 'deadbeef');
    expect(line).toBe(`Genoa · ${REAL.ReferenceValues.snp[0].TrustedMeasurement.slice(0, 8)}`);
  });

  it('omits an absent product name instead of printing "undefined ·"', () => {
    const m = { ReferenceValues: { snp: [{ TrustedMeasurement: 'abcdef0123456789' }] } };
    expect(proofSummary(m, null)).toBe('abcdef01');
  });

  it('falls back to the manifest digest when a deployment reports no SNP values', () => {
    expect(proofSummary({}, '1d65f5646afdab15')).toBe('manifest 1d65f564');
  });

  // Better to show nothing than a confident-looking placeholder — which is
  // exactly how "(manifest carried no digest)" reached production.
  it('returns null when there is nothing honest to show', () => {
    expect(proofSummary({}, null)).toBeNull();
    expect(proofSummary(undefined, undefined)).toBeNull();
  });
});

describe('policySummary', () => {
  it('counts the policies and names the distinct roles', () => {
    const { count, roles } = policySummary(REAL);
    expect(count).toBe(Object.keys(REAL.Policies).length);
    expect(count).toBeGreaterThan(0);
    expect(roles).toContain('coordinator');
  });

  it('handles a manifest with no policies', () =>
    expect(policySummary({})).toEqual({ count: 0, roles: [] }));
});

describe('digestHex', () => {
  it('hashes the raw bytes, reproducibly by anyone with the same manifest', async () => {
    const hex = await digestHex(BYTES);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // Same value as: sha256sum manifest.json
    const { createHash } = await import('node:crypto');
    expect(hex).toBe(createHash('sha256').update(BYTES).digest('hex'));
  });

  it('differs when a single byte changes', async () => {
    const tampered = Buffer.from(BYTES);
    tampered[10] ^= 0xff;
    expect(await digestHex(tampered)).not.toBe(await digestHex(BYTES));
  });

  it.each([null, undefined, new Uint8Array(0)])('returns null for %j', async (input) =>
    expect(await digestHex(input)).toBeNull());
});

describe('shortHex', () => {
  it('takes eight characters by default', () => expect(shortHex('0123456789abcdef')).toBe('01234567'));
  it('is empty for a missing value', () => expect(shortHex(undefined)).toBe(''));
});
