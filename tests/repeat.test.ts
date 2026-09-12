// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  html,
  hydrate,
  mount,
  on,
  repeat,
  signal,
  tick,
} from '../src/index.js';
import type { Writable } from '../src/index.js';
import { renderToString } from '../src/server.js';

interface Row {
  id: string;
  label: string;
}

function list(rows: Writable<Row[]>, clicks: string[]) {
  return html`<ul>
    ${repeat(
      rows,
      (row) => row.id,
      (row) =>
        html`<li>
          <span>${() => row.value.label}</span>
          <input aria-label="Draft" />
          <button ${on('click', () => clicks.push(row.value.label))}>
            Select
          </button>
        </li>`,
    )}
  </ul>`;
}

describe('keyed repeat', () => {
  for (const mode of ['mount', 'hydrate'] as const) {
    it(`preserves keyed DOM, input state and current item data after ${mode}`, async () => {
      const rows = signal<Row[]>([
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ]);
      const clicks: string[] = [];
      const content = list(rows, clicks);
      const host = document.createElement('div');
      if (mode === 'hydrate') host.innerHTML = renderToString(content);
      const originalB = host.querySelectorAll('li')[1];
      const dispose =
        mode === 'hydrate' ? hydrate(host, content) : mount(host, content);
      const b = host.querySelectorAll('li')[1]!;
      if (mode === 'hydrate') expect(b).toBe(originalB);
      const draft = b.querySelector('input')!;
      draft.value = 'unfinished';

      rows.value = [
        { id: 'b', label: 'Beta updated' },
        { id: 'a', label: 'Alpha' },
        { id: 'c', label: 'Gamma' },
      ];
      await tick();
      expect(
        [...host.querySelectorAll('li')].map(
          (item) => item.querySelector('span')?.textContent,
        ),
      ).toEqual(['Beta updated', 'Alpha', 'Gamma']);
      expect(host.querySelectorAll('li')[0]).toBe(b);
      expect(host.querySelectorAll('li')[0]?.querySelector('input')).toBe(
        draft,
      );
      expect(draft.value).toBe('unfinished');
      b.querySelector('button')?.click();
      expect(clicks).toEqual(['Beta updated']);

      rows.value = [{ id: 'b', label: 'Beta final' }];
      await tick();
      expect(host.querySelectorAll('li')).toHaveLength(1);
      expect(host.querySelector('span')?.textContent).toBe('Beta final');
      dispose();
    });
  }

  it('rejects duplicate and invalid keys before rendering', () => {
    const duplicate = repeat(
      [{ id: 'a' }, { id: 'a' }],
      (row) => row.id,
      (row) => html`<p>${row.value.id}</p>`,
    );
    expect(() => renderToString(duplicate)).toThrow('Duplicate repeat key');
    const invalid = repeat(
      [1],
      () => Number.NaN,
      (row) => html`<p>${row.value}</p>`,
    );
    expect(() => renderToString(invalid)).toThrow('repeat key');
  });
});
