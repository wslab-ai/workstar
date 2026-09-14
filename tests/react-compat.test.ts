// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { tick } from '../src/index.js';
import { createRoot } from '../src/compat/react/client.js';
import { createPortal } from '../src/compat/react/dom.js';
import {
  Children,
  StrictMode,
  Suspense,
  cloneElement,
  createContext,
  isValidElement,
  lazy,
  useContext,
  useEffect,
  useRef,
  useReducer,
  useState,
} from '../src/compat/react/index.js';
import ReactCompat from '../src/compat/react/index.js';
import { jsx } from '../src/compat/react/jsx-runtime.js';

describe('Workstar React source runtime', () => {
  it('renders nested icon shapes with SVG attributes and namespaces', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    root.render(
      jsx('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        children: [
          jsx('path', { d: 'M2 2L22 22' }),
          jsx('circle', { cx: 12, cy: 12, r: 3 }),
        ],
      }),
    );

    const svg = host.querySelector('svg');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
    expect(svg?.querySelector('path')?.namespaceURI).toBe(
      'http://www.w3.org/2000/svg',
    );
    expect(svg?.querySelector('circle')?.namespaceURI).toBe(
      'http://www.w3.org/2000/svg',
    );
    root.unmount();
  });

  it('supports React namespace imports and element helpers used by component libraries', () => {
    const child = jsx(
      'button',
      { children: 'Save', className: 'base' },
      'save',
    );
    const clone = cloneElement(child, { className: 'active' });
    expect(ReactCompat.forwardRef).toBeDefined();
    expect(isValidElement(clone)).toBe(true);
    expect(clone.props).toMatchObject({
      children: 'Save',
      className: 'active',
    });
    expect(clone.key).toBe('save');
    expect(Children.toArray([null, child, false, [clone]])).toHaveLength(2);
    expect(
      Children.map([child], (entry) =>
        cloneElement(entry as typeof child, { title: 'mapped' }),
      ),
    ).toHaveLength(1);
    expect(Children.count([null, child, false])).toBe(3);
    expect(Children.only(child)).toBe(child);
    expect(() => Children.only([child])).toThrow();
  });

  it('renders authored style text without treating it as HTML', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    root.render(
      jsx('style', {
        dangerouslySetInnerHTML: { __html: '.loading { color: red; }' },
      }),
    );
    expect(host.querySelector('style')?.textContent).toBe(
      '.loading { color: red; }',
    );
    root.unmount();
    const plainRoot = createRoot(host);
    plainRoot.render(jsx('style', { children: '.table { width: 100%; }' }));
    expect(host.querySelector('style')?.textContent).toBe(
      '.table { width: 100%; }',
    );
    plainRoot.unmount();
  });

  it('preserves styles added by an imperative widget during rerenders', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    root.render(jsx('div', { style: { minHeight: '400px' } }));
    const mapContainer = host.firstElementChild as HTMLElement;

    mapContainer.style.position = 'relative';
    root.render(jsx('div', { style: { minHeight: '400px' } }));
    await tick();
    expect(mapContainer.style.position).toBe('relative');

    root.render(jsx('div', { style: { minHeight: '500px' } }));
    await tick();
    expect(mapContainer.style.minHeight).toBe('500px');
    expect(mapContainer.style.position).toBe('relative');

    root.render(jsx('div', { style: {} }));
    await tick();
    expect(mapContainer.style.minHeight).toBe('');
    expect(mapContainer.style.position).toBe('relative');
    root.unmount();
  });

  it('keeps context available in a portal and removes its host on unmount', async () => {
    const host = document.createElement('div');
    const context = createContext('missing');
    function Dialog() {
      return createPortal(
        jsx('span', { children: useContext(context) }),
        document.body,
      );
    }
    function App() {
      const [value, setValue] = useState('Ready');
      return jsx(context.Provider, {
        value,
        children: [
          jsx('button', { onClick: () => setValue('Updated') }),
          jsx(Dialog, {}),
        ],
      });
    }
    const root = createRoot(host);
    root.render(jsx(App, {}));
    expect(
      document.querySelector('[data-workstar-portal] span')?.textContent,
    ).toBe('Ready');
    host.querySelector('button')?.click();
    await tick();
    expect(
      document.querySelector('[data-workstar-portal] span')?.textContent,
    ).toBe('Updated');
    root.unmount();
    expect(document.querySelector('[data-workstar-portal]')).toBeNull();
  });

  it('updates state through a reducer', async () => {
    const host = document.createElement('div');
    function Counter() {
      const [count, dispatch] = useReducer(
        (value: number, delta: number) => value + delta,
        0,
      );
      return jsx('button', { onClick: () => dispatch(2), children: count });
    }
    const root = createRoot(host);
    root.render(jsx(Counter, {}));
    host.querySelector('button')?.click();
    await tick();
    expect(host.querySelector('button')?.textContent).toBe('2');
    root.unmount();
  });

  it('coalesces state that returns to its rendered value in one turn', async () => {
    const host = document.createElement('div');
    let change: ((value: number | null) => void) | undefined;
    let renders = 0;
    function View() {
      const [value, setValue] = useState<number | null>(1);
      change = setValue;
      renders++;
      return jsx('span', { children: value });
    }
    const root = createRoot(host);
    root.render(jsx(View, {}));
    change?.(null);
    change?.(1);
    await tick();
    expect(renders).toBe(1);
    expect(host.textContent).toBe('1');
    root.unmount();
  });

  it('updates root component props without forcing unrelated state', async () => {
    const host = document.createElement('div');
    function View({ label }: { label: string }) {
      return jsx('span', { children: label });
    }
    const root = createRoot(host);
    root.render(jsx(View, { label: 'First' }));
    root.render(jsx(View, { label: 'Second' }));
    await tick();
    expect(host.textContent).toBe('Second');
    root.unmount();
  });

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
    const base64 = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4" fill="red"/></svg>')}`;
    const base64Root = createRoot(host);
    base64Root.render(jsx('img', { src: base64 }));
    expect(host.querySelector('img')?.getAttribute('src')).toBe(base64);
    base64Root.unmount();
    expect(() => createRoot(host).render(jsx('img', { src: unsafe }))).toThrow(
      'Unsafe SVG data image',
    );
    expect(() => createRoot(host).render(jsx('script', { src: safe }))).toThrow(
      'Unsafe URL',
    );
  });
});
