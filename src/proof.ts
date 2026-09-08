// Attestation: the one session this page holds, and the UI that shows its state.
// Two jobs in one file on purpose — the session needs the build-time options only
// this browser project can see, and nothing but this UI ever opens or closes it.
// transcribe.ts reads `session` from here rather than through a third module.

import { makeClient } from './client';
import { $, el, messageOf, note, setKeyState } from './dom';
import { measurements, policySummary, proofSummary } from './manifest';
import { createSession, type Sealed } from './session';
import { K, store } from './storage';
import type { ProofState } from './types';

export const session = createSession(
  makeClient,
  {
    dangerouslyAllowBrowser: true, // §1.3 — key owner and user are the same person
    browserWasmURL: `${import.meta.env.BASE_URL}privatemode.wasm`, // same-origin, never a CDN
    expectedWasmHash: __WASM_SHA256__, // pinned at build time
  },
  (e) => note($('keyNote'), `Lost the secure channel: ${e.message}`, true),
);

const link = (href: string, text: string): HTMLAnchorElement =>
  el('a', { href, textContent: text, target: '_blank', rel: 'noreferrer' });

export function renderProof(state: ProofState, sealed?: Sealed): void {
  const chip = $('chip');
  const proof = $('proof');
  proof.dataset['state'] = chip.dataset['state'] = state;

  if (state !== 'sealed' || !sealed) {
    chip.textContent = state === 'verifying' ? 'verifying' : 'unverified';
    $('proofMark').textContent = '○';
    $('proofLine').textContent = state === 'verifying' ? 'Verifying…' : 'Not verified';
    return;
  }

  const { manifest, manifestDigest } = sealed;
  chip.textContent = 'sealed';
  $('proofMark').textContent = '✓';
  // Null means the manifest carried nothing worth quoting. Say "Verified" and
  // let the detail speak, rather than printing a placeholder that looks like a
  // measurement — which is exactly how "(manifest carried no digest)" shipped.
  $('proofLine').textContent = proofSummary(manifest, manifestDigest) ?? 'Verified';

  const rows: [label: string, value: string][] = [];
  for (const { product, measurement } of measurements(manifest)) {
    rows.push(['SEV-SNP launch measurement', product ? `${measurement}  (${product})` : measurement]);
  }
  if (manifestDigest) rows.push(['Manifest SHA-256', manifestDigest]);
  // Not a defence — a page that lied about its own code would lie about this
  // too. It is an audit aid: compare it against a reproducible build of the SDK
  // (ARCHITECTURE.md §1.4). The enforcement is expectedWasmHash, which the SDK
  // checks before instantiation and which fails closed.
  rows.push(['Verifier Wasm SHA-256 (pinned, enforced)', __WASM_SHA256__]);
  const { count, roles } = policySummary(manifest);
  if (count) {
    rows.push(['Workload policies', `${count}${roles.length ? ` · ${roles.join(', ')}` : ''}`]);
  }

  const dl = el('dl', { className: 'proof-rows' });
  rows.forEach(([label, value]) => {
    dl.append(el('dt', { textContent: label }), el('dd', { textContent: value }));
  });
  $('digest').replaceChildren(dl);

  $('proofMeta').replaceChildren(
    `Attested enclave, verified ${new Date().toLocaleTimeString()}. Every transcript records this measurement. `,
    link('https://docs.privatemode.ai/security/attestation/overview', 'How attestation works'),
    ' · ',
    link('https://cdn.confidential.cloud/privatemode/v2/manifest.json', 'The manifest itself'),
    ' · ',
    link('https://docs.privatemode.ai/reference/sdk/verify-from-source', 'Verify the SDK from source'),
    ' · ',
    link('https://github.com/dhcgn/hushscribe', 'This page’s source'),
  );
}

/**
 * Verify the key in the field: the Verify button, Enter in the field, and the
 * drop-before-verify path all end up here. True when the session is open.
 */
export async function verifyKey(): Promise<boolean> {
  const apiKey = $('key').value.trim();
  if (!apiKey) {
    note($('keyNote'), 'Enter a key first.', true);
    return false;
  }

  renderProof('verifying');
  note($('keyNote'), '');
  $('verify').disabled = true;
  try {
    const sealed = await session.verify(apiKey);
    renderProof('sealed', sealed);
    const saved = store.save(K.key, apiKey);
    setKeyState(saved ? 'saved' : 'none');
    note($('keyNote'), saved
      ? 'Key saved in this browser.'
      : 'Key verified for this tab. This browser could not save it.');
    return true;
  } catch (e) {
    // session.verify has already ended the session it failed to open. Reveal
    // the key field again: whatever is stored did not work.
    renderProof('idle');
    setKeyState('none');
    note($('keyNote'), `Verification failed: ${messageOf(e)}`, true);
    return false;
  } finally {
    $('verify').disabled = false;
  }
}

/** Close the session and show it: used by "Forget key" and "Clear everything". */
export function endSession(): void {
  session.end();
  renderProof('idle');
}
