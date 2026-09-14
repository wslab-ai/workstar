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
    expect(host.querySelector('button')?.textContent).toBe('0');
    host.querySelector('button')?.click();
    await tick();
    expect(host.querySelector('button')?.textContent).toBe('1');
    root.unmount();
    expect(host.childNodes).toHaveLength(0);
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
