// Reading the attestation manifest for display.
//
// The Manifest has NO `digest` field. Its real shape (see the SDK's manifest.d.ts
// and https://docs.privatemode.ai/reference/sdk/manifest) is:
//
//   { Policies?:              Record<policyHash, {SANs, WorkloadSecretID, Role?}>,
//     ReferenceValues?:       { snp?: [{ ProductName, TrustedMeasurement, ... }] },
//     SeedshareOwnerPubKeys?: string[] }
//
// `TrustedMeasurement` is the SEV-SNP launch measurement — 96 hex characters
// identifying the exact confidential VM image. That is the enclave identity worth
// showing; everything else is supporting detail.
//
// Pure apart from digestHex, which uses WebCrypto. Tested against a real manifest
// in test/manifest.test.js.

/** @returns {{product: string, measurement: string}[]} */
export function measurements(manifest) {
  return (manifest?.ReferenceValues?.snp ?? [])
    .map((entry) => ({
      product: entry?.ProductName ?? '',
      measurement: entry?.TrustedMeasurement ?? '',
    }))
    .filter((m) => m.measurement);
}

/** First `n` characters — enough to recognise a measurement you have seen before. */
export const shortHex = (hex, n = 8) => (hex ?? '').slice(0, n);

/**
 * The one-line summary beside the green check, e.g. "Genoa · ea6a6655".
 * Falls back to the manifest digest when a deployment reports no SNP reference
 * values, and to null when there is nothing honest to show at all.
 */
export function proofSummary(manifest, manifestDigest) {
  const [first] = measurements(manifest);
  if (first) {
    return first.product
      ? `${first.product} · ${shortHex(first.measurement)}`
      : shortHex(first.measurement);
  }
  return manifestDigest ? `manifest ${shortHex(manifestDigest)}` : null;
}

/** Policy count and the distinct named roles, for the expanded detail. */
export function policySummary(manifest) {
  const policies = manifest?.Policies ?? {};
  const roles = [...new Set(Object.values(policies).map((p) => p?.Role).filter(Boolean))];
  return { count: Object.keys(policies).length, roles };
}

/**
 * SHA-256 of the raw manifest bytes, hex-encoded.
 *
 * Hash the bytes, never a re-serialised object: the SDK warns that JSON
 * round-tripping can alter them, which would produce a digest nobody else can
 * reproduce. Anyone can check this against the manifest on the Privatemode CDN.
 */
export async function digestHex(bytes) {
  if (!bytes?.byteLength) return null;
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
