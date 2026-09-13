// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { createHotContext, preserveFormState } from '../src/dev.js';

describe('development form state', () => {
  it('isolates reactive state by component identity', () => {
    const root = createHotContext();
    const first = root.child('first');
    const second = root.child('second');
    const signal = { value: 3 };
    expect(first.state('count', () => signal)).toBe(signal);
    expect(root.child('first').state('count', () => ({ value: 0 }))).toBe(
      signal,
    );
    expect(second.state('count', () => ({ value: 0 }))).not.toBe(signal);
  });

  it('restores unfinished native fields and focus after a view replacement', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = `<form>
      <input name="draft" aria-label="Draft">
      <input name="approved" type="checkbox">
      <select name="topics" multiple>
        <option value="a">A</option><option value="b">B</option>
      </select>
    </form>`;
    const draft = host.querySelector<HTMLInputElement>('[name=draft]')!;
    draft.value = 'Unsent note';
    draft.focus();
    draft.setSelectionRange(2, 5);
    host.querySelector<HTMLInputElement>('[name=approved]')!.checked = true;
    host.querySelector<HTMLOptionElement>('option[value=b]')!.selected = true;

    await preserveFormState(host, () => {
      host.innerHTML = `<form><p>New copy</p>
        <input name="draft" aria-label="Draft">
        <input name="approved" type="checkbox">
        <select name="topics" multiple>
          <option value="a">A</option><option value="b">B</option>
        </select>
      </form>`;
    });

    const restored = host.querySelector<HTMLInputElement>('[name=draft]')!;
    expect(restored.value).toBe('Unsent note');
    expect(restored.selectionStart).toBe(2);
    expect(restored.selectionEnd).toBe(5);
    expect(document.activeElement).toBe(restored);
    expect(
      host.querySelector<HTMLInputElement>('[name=approved]')!.checked,
    ).toBe(true);
    expect(
      host.querySelector<HTMLOptionElement>('option[value=b]')!.selected,
    ).toBe(true);
    host.remove();
  });
});
