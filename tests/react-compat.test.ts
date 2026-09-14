// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { tick } from '../src/index.js';
import { createRoot } from '../src/compat/react/client.js';
import {
  StrictMode,
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useRef,
  useState,
} from '../src/compat/react/index.js';
import { jsx } from '../src/compat/react/jsx-runtime.js';

describe('Workstar React source runtime', () => {
  it('mounts a component and updates state from a native event', async () => {
    const host = document.createElement('div');
    function Counter() {
      const [count, setCount] = useState(0);
      return jsx('button', {
        onClick: () => setCount((current) => current + 1),
        children: count,
      });
    }
    const root = createRoot(host);
    root.render(jsx(StrictMode, { children: jsx(Counter, {}) }));
    const button = host.querySelector('button');
    expect(button?.textContent).toBe('0');
    button?.click();
    await tick();
    expect(host.querySelector('button')?.textContent).toBe('1');
    expect(host.querySelector('button')).toBe(button);
    root.unmount();
    expect(host.childNodes).toHaveLength(0);
  });

  it('preserves an untouched form field when sibling state changes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let increment: (() => void) | undefined;
    let appRenders = 0;
    let counterRenders = 0;
    function Counter() {
      counterRenders++;
      const [count, setCount] = useState(0);
      increment = () => setCount((value) => value + 1);
      return jsx('output', { children: count });
    }
    function App() {
      appRenders++;
      return jsx('main', {
        children: [
          jsx('input', { name: 'draft', defaultValue: '' }),
          jsx(Counter, {}),
        ],
      });
    }
    const root = createRoot(host);
    root.render(jsx(App, {}));
    const main = host.querySelector('main');
    const field = host.querySelector('input');
    if (!field) throw new Error('Missing input');
    field.value = 'unfinished work';
    field.focus();
    increment?.();
    await tick();
    expect(host.querySelector('main')).toBe(main);
    expect(host.querySelector('input')).toBe(field);
    expect(field.value).toBe('unfinished work');
    expect(document.activeElement).toBe(field);
    expect(host.querySelector('output')?.textContent).toBe('1');
    expect(appRenders).toBe(1);
    expect(counterRenders).toBe(2);
    root.unmount();
    host.remove();
  });

  it('moves keyed rows without recreating their inputs', async () => {
    const host = document.createElement('div');
    let reverse: (() => void) | undefined;
    function List() {
      const [rows, setRows] = useState([
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ]);
      reverse = () => setRows((current) => [...current].reverse());
      return jsx('ul', {
        children: rows.map((row) =>
          jsx(
            'li',
            {
              children: [
                jsx('span', { children: row.label }),
                jsx('input', { defaultValue: '' }),
              ],
            },
            row.id,
          ),
        ),
      });
    }
    const root = createRoot(host);
    root.render(jsx(List, {}));
    const original = host.querySelectorAll('li')[1];
    const field = original?.querySelector('input');
    if (!field) throw new Error('Missing row input');
    field.value = 'draft';
    reverse?.();
    await tick();
    expect(host.querySelectorAll('li')[0]).toBe(original);
    expect(host.querySelectorAll('li')[0]?.querySelector('input')).toBe(field);
    expect(field.value).toBe('draft');
    root.unmount();
  });

  it('updates controlled form properties on a retained input', async () => {
    const host = document.createElement('div');
    let setValue: ((value: string) => void) | undefined;
    let setChecked: ((value: boolean) => void) | undefined;
    function Form() {
      const [value, changeValue] = useState('first');
      const [checked, changeChecked] = useState(false);
      setValue = changeValue;
      setChecked = changeChecked;
      return jsx('form', {
        children: [
          jsx('input', { name: 'label', value }),
          jsx('input', { name: 'enabled', type: 'checkbox', checked }),
        ],
      });
    }
    const root = createRoot(host);
    root.render(jsx(Form, {}));
    const text = host.querySelector<HTMLInputElement>('input[name="label"]');
    const checkbox = host.querySelector<HTMLInputElement>(
      'input[name="enabled"]',
    );
    if (!text || !checkbox) throw new Error('Missing form input');
    text.value = 'edited';
    setValue?.('second');
    setChecked?.(true);
    await tick();
    expect(host.querySelector('input[name="label"]')).toBe(text);
    expect(text.value).toBe('second');
    expect(checkbox.checked).toBe(true);
    root.unmount();
  });

  it('propagates context changes and cleans up effects and element refs', async () => {
    const host = document.createElement('div');
    const Language = createContext('en');
    const cleanup = vi.fn();
    let changeLanguage: ((value: string) => void) | undefined;
    let field: { current: HTMLInputElement | null } | undefined;
    function Label() {
      const language = useContext(Language);
      field = useRef<HTMLInputElement | null>(null);
      useEffect(() => cleanup, []);
      return jsx('input', {
        ref: field,
        'aria-label': language,
        defaultValue: language,
      });
    }
    function App() {
      const [language, setLanguage] = useState('en');
      changeLanguage = setLanguage;
      return jsx(Language.Provider, {
        value: language,
        children: jsx(Label, {}),
      });
    }
    const root = createRoot(host);
    root.render(jsx(App, {}));
    await tick();
    expect(field?.current).toBe(host.querySelector('input'));
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('en');
    changeLanguage?.('ru');
    await tick();
    expect(host.querySelector('input')?.getAttribute('aria-label')).toBe('ru');
    root.unmount();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(field?.current).toBeNull();
  });

  it('shows Suspense fallback until a lazy component resolves', async () => {
    const host = document.createElement('div');
    let resolveModule:
      ((module: { default: () => unknown }) => void) | undefined;
    const Lazy = lazy(
      () =>
        new Promise((resolve) => {
          resolveModule = resolve;
        }),
    );
    const root = createRoot(host);
    root.render(
      jsx(Suspense, {
        fallback: jsx('p', { children: 'Loading' }),
        children: jsx(Lazy, {}),
      }),
    );
    expect(host.querySelector('p')?.textContent).toBe('Loading');
    resolveModule?.({ default: () => jsx('strong', { children: 'Ready' }) });
    await tick();
    await tick();
    expect(host.querySelector('strong')?.textContent).toBe('Ready');
    root.unmount();
  });

  it('accepts restricted SVG data images only on img elements', () => {
    const safe = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4" fill="red"/></svg>')}`;
    const unsafe = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')}`;
    const host = document.createElement('div');
    const root = createRoot(host);
    root.render(jsx('img', { src: safe }));
    expect(host.querySelector('img')?.getAttribute('src')).toBe(safe);
    root.unmount();
    expect(() => createRoot(host).render(jsx('img', { src: unsafe }))).toThrow(
      'Unsafe SVG data image',
    );
    expect(() => createRoot(host).render(jsx('script', { src: safe }))).toThrow(
      'Unsafe URL',
    );
  });
});
