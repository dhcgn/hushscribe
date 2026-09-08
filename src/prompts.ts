// The prompt field, its character budget, and the saved-prompt picker.

import { $, el } from './dom';
import { promptBudget } from './segments';
import { K, store } from './storage';

export function renderCount(): void {
  const { level, message } = promptBudget($('prompt').value);
  const c = $('count');
  c.dataset['level'] = level;
  c.textContent = message;
}

export function renderPrompts(): void {
  const sel = $('prompts');
  sel.replaceChildren(el('option', { value: '', textContent: 'Saved prompts…' }));
  store.load(K.prompts, []).forEach((p, i) => {
    sel.append(el('option', {
      value: String(i),
      textContent: p.length > 46 ? `${p.slice(0, 46)}…` : p,
    }));
  });
}

export function savePrompt(): void {
  const v = $('prompt').value.trim();
  if (!v) return;
  const list = store.load(K.prompts, []);
  if (list.includes(v)) return;
  list.push(v);
  store.save(K.prompts, list);
  renderPrompts();
}

/** Put the picked saved prompt into the field. */
export function pickPrompt(): void {
  const sel = $('prompts');
  if (sel.value === '') return;
  $('prompt').value = store.load(K.prompts, [])[Number(sel.value)] ?? '';
  renderCount();
}

export function deletePrompt(): void {
  const sel = $('prompts');
  if (sel.value === '') return;
  const list = store.load(K.prompts, []);
  list.splice(Number(sel.value), 1);
  store.save(K.prompts, list);
  renderPrompts();
}
