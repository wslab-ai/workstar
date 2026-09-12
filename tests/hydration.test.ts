// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { attr, html, hydrate, on, signal, tick } from '../src/index.js';
import { renderToString } from '../src/server.js';

describe('hydration', () => {
  it('preserves server DOM and attaches reactive events and attributes', async () => {
    const host = document.createElement('div');
    const count = signal(0);
    const content = html`<button
      ${on('click', () => count.update((value) => value + 1))}
      ${attr('aria-label', () => `Count ${count.value}`)}
    >
      ${count}
    </button>`;
    host.innerHTML = renderToString(content);
    const serverButton = host.querySelector('button');
    const dispose = hydrate(host, content);

    expect(host.querySelector('button')).toBe(serverButton);
    expect(serverButton?.getAttribute('aria-label')).toBe('Count 0');
    serverButton?.click();
    await tick();
    expect(host.querySelector('button')).toBe(serverButton);
    expect(serverButton?.textContent?.trim()).toBe('1');
    expect(serverButton?.getAttribute('aria-label')).toBe('Count 1');
    dispose();
    expect(host.childNodes).toHaveLength(0);
  });

  it('hydrates nested conditional content and keyed array regions', async () => {
    const host = document.createElement('div');
    const visible = signal(true);
    const label = signal('first');
    const content = html`<main>
      ${() => (visible.value ? html`<p>${label}</p>` : null)}
      ${[html`<span>${'A'}</span>`, html`<span>${'B'}</span>`]}
    </main>`;
    host.innerHTML = renderToString(content);
    const paragraph = host.querySelector('p');
    const spans = host.querySelectorAll('span');
    hydrate(host, content);

    expect(host.querySelector('p')).toBe(paragraph);
    expect(host.querySelectorAll('span')[0]).toBe(spans[0]);
    label.value = 'second';
    await tick();
    expect(paragraph?.textContent).toBe('second');
    visible.value = false;
    await tick();
    expect(host.querySelector('p')).toBeNull();
  });

  it('rejects changed server text without destroying the page', () => {
    const host = document.createElement('div');
    const content = html`<p>${'expected'}</p>`;
    host.innerHTML = renderToString(content).replace('expected', 'changed');

    expect(() => hydrate(host, content)).toThrow('Hydration text mismatch');
    expect(host.querySelector('p')?.textContent).toBe('changed');
  });
});
