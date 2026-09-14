// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { attr, attrs, html, mount, on, signal, tick } from '../src/index.js';

describe('DOM templates', () => {
  it('binds text, attributes, and events without replacing the button', async () => {
    const host = document.createElement('div');
    const count = signal(0);
    const dispose = mount(
      host,
      html`<button
        ${on('click', () => count.update((value) => value + 1))}
        ${attr('aria-label', () => `Count ${count.value}`)}
      >
        ${count}
      </button>`,
    );
    const button = host.querySelector('button');

    expect(button?.textContent?.trim()).toBe('0');
    button?.click();
    await tick();
    expect(button?.textContent?.trim()).toBe('1');
    expect(button?.getAttribute('aria-label')).toBe('Count 1');
    expect(host.querySelector('button')).toBe(button);
    dispose();
    expect(host.childNodes).toHaveLength(0);
  });

  it('renders untrusted strings only as text', () => {
    const host = document.createElement('div');
    const unsafe = '<img src=x onerror=alert(1)>';
    mount(host, html`<p>${unsafe}</p>`);

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('p')?.textContent).toBe(unsafe);
  });

  it('disposes nested subscriptions when a conditional view disappears', async () => {
    const host = document.createElement('div');
    const visible = signal(true);
    const count = signal(1);
    mount(
      host,
      html`<div>
        ${() => (visible.value ? html`<span>${count}</span>` : null)}
      </div>`,
    );

    expect(host.querySelector('span')?.textContent).toBe('1');
    visible.value = false;
    await tick();
    expect(host.querySelector('span')).toBeNull();
    count.value = 2;
    await tick();
    expect(host.querySelector('span')).toBeNull();
  });

  it('rejects unsafe URL attributes and accidental attribute interpolation', () => {
    const host = document.createElement('div');
    expect(() =>
      mount(host, html`<a ${attr('href', 'java\nscript:alert(1)')}>Bad</a>`),
    ).toThrow('Unsafe URL');
    expect(() => mount(host, html`<a href="${'/safe'}">Bad</a>`)).toThrow(
      'Dynamic attributes',
    );
    expect(() => attr('onclick', 'alert(1)')).toThrow('unsafe attribute');
  });

  it('updates a text node in place for primitive changes', async () => {
    const host = document.createElement('div');
    const label = signal('first');
    mount(host, html`<p>${label}</p>`);
    const textNode = host.querySelector('p')?.firstChild?.nextSibling;

    label.value = 'second';
    await tick();
    expect(host.querySelector('p')?.firstChild?.nextSibling).toBe(textNode);
    expect(host.querySelector('p')?.textContent).toBe('second');
  });

  it('cleans up an earlier view when the same host is mounted again', async () => {
    const host = document.createElement('div');
    const first = signal('first');
    const disposeFirst = mount(host, html`<p>${first}</p>`);
    const disposeSecond = mount(host, html`<p>second</p>`);

    first.value = 'stale';
    await tick();
    expect(host.querySelector('p')?.textContent).toBe('second');
    disposeFirst();
    expect(host.querySelector('p')?.textContent).toBe('second');
    disposeSecond();
    expect(host.childNodes).toHaveLength(0);
  });

  it('updates an attribute spread without replacing its element', async () => {
    const host = document.createElement('div');
    const attributes = signal<Record<string, unknown>>({
      title: 'First',
      'aria-hidden': false,
    });
    mount(host, html`<output ${attrs(attributes)}></output>`);
    const output = host.querySelector('output');
    expect(output?.title).toBe('First');
    expect(output?.getAttribute('aria-hidden')).toBe('false');
    attributes.value = { 'data-state': 'ready' };
    await tick();
    expect(host.querySelector('output')).toBe(output);
    expect(output?.hasAttribute('title')).toBe(false);
    expect(output?.getAttribute('data-state')).toBe('ready');
  });
});
