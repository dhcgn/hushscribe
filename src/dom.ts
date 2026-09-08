// The handful of DOM helpers everything else shares. No state lives here.

import type { KeyState, View } from './types';

/**
 * Every id in index.html and the element it names. A compile-time inventory:
 * `$('kye')` is a type error, and `$('key').value` needs no cast.
 */
export interface Ids {
  viewToggle: HTMLButtonElement;
  chip: HTMLDivElement;
  proof: HTMLDetailsElement;
  proofMark: HTMLSpanElement;
  proofLine: HTMLSpanElement;
  keyEdit: HTMLButtonElement;
  digest: HTMLDivElement;
  proofMeta: HTMLParagraphElement;
  guide: HTMLDetailsElement;
  access: HTMLElement;
  key: HTMLInputElement;
  verify: HTMLButtonElement;
  clearKey: HTMLButtonElement;
  mkLink: HTMLButtonElement;
  keyNote: HTMLParagraphElement;
  model: HTMLSelectElement;
  rate: HTMLParagraphElement;
  lang: HTMLSelectElement;
  prompt: HTMLTextAreaElement;
  count: HTMLParagraphElement;
  savePrompt: HTMLButtonElement;
  prompts: HTMLSelectElement;
  delPrompt: HTMLButtonElement;
  drop: HTMLDivElement;
  picker: HTMLInputElement;
  results: HTMLDivElement;
  ephemeral: HTMLInputElement;
  history: HTMLDivElement;
  exportAll: HTMLButtonElement;
  inclKey: HTMLInputElement;
  clearHist: HTMLButtonElement;
  clearAll: HTMLButtonElement;
  dataNote: HTMLParagraphElement;
  keyWarn: HTMLParagraphElement;
  version: HTMLAnchorElement;
}

export const $ = <K extends keyof Ids>(id: K): Ids[K] => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing from index.html`);
  return node as Ids[K];
};

/** `el('a', { href, textContent })` — create and assign in one go, typed by tag. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]>,
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props ?? {});
}

/** A status line: plain, or a warning. */
export const note = (target: HTMLElement, msg: string, warn = false): void => {
  target.textContent = msg;
  target.classList.toggle('warn', warn);
};

/** A readable message for anything thrown. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/*
 * Comfortable (default) or compact. public/view-init.js applies the saved value
 * before first paint; this only keeps the button and the attribute in step.
 */
export function setView(view: View): void {
  const compact = view === 'compact';
  document.documentElement.dataset['view'] = compact ? 'compact' : 'comfortable';
  const b = $('viewToggle');
  b.setAttribute('aria-pressed', String(compact));
  b.textContent = compact ? 'Full' : 'Compact';
  b.title = compact
    ? 'Bring back the explanations and the roomier layout'
    : 'Hide the explanatory text and tighten the layout';
}

/*
 * Compact hides the key field once a key is stored — but never while it is
 * unusable, or a bad key would be unfixable without finding the view toggle.
 */
export function setKeyState(state: KeyState): void {
  document.documentElement.dataset['key'] = state;
}
