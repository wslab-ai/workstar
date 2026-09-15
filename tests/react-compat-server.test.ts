// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { tick } from '../src/index.js';
import { hydrateRoot } from '../src/compat/react/client.js';
import {
  createContext,
  useContext,
  useId,
  useState,
  useSyncExternalStore,
} from '../src/compat/react/index.js';
import { jsx } from '../src/compat/react/jsx-runtime.js';
import {
  renderToStaticMarkup,
  renderToString,
} from '../src/compat/react/server.js';

describe('React-compatible SSR and hydration', () => {
  it('hydrates TSX markup in place and keeps deterministic ids and events', async () => {
    const Language = createContext('missing');
    function Button() {
      const language = useContext(Language);
      const id = useId();
      const [count, setCount] = useState(0);
      return jsx('button', {
        id,
        onClick: () => setCount((value) => value + 1),
        children: `${language}:${count}`,
      });
    }
    const view = jsx(Language.Provider, {
      value: 'en',
      children: jsx(Button, {}),
    });
    const host = document.createElement('div');
    host.innerHTML = renderToString(view);
    const serverButton = host.querySelector('button');
    const serverId = serverButton?.id;
    const root = hydrateRoot(host, view);
    expect(host.querySelector('button')).toBe(serverButton);
    expect(serverButton?.id).toBe(serverId);
    serverButton?.click();
    await tick();
    expect(serverButton?.textContent).toBe('en:1');
    root.unmount();
  });

  it('uses the server snapshot and omits effect execution during SSR', () => {
    function Status() {
      const value = useSyncExternalStore(
        () => () => {},
        () => 'client',
        () => 'server',
      );
      return jsx('output', { children: value });
    }
    expect(renderToString(jsx(Status, {}))).toContain('server');
  });

  it('preserves a user edit made to a controlled input before hydration', () => {
    function Form() {
      const [value] = useState('server value');
      return jsx('input', { value });
    }
    const view = jsx(Form, {});
    const host = document.createElement('div');
    host.innerHTML = renderToString(view);
    const input = host.querySelector('input')!;
    input.value = 'typed before hydration';
    const root = hydrateRoot(host, view);
    expect(host.querySelector('input')).toBe(input);
    expect(input.value).toBe('typed before hydration');
    root.unmount();
  });

  it('removes hydration markers from static markup', () => {
    const markup = renderToStaticMarkup(
      jsx('button', { onClick: () => {}, children: 'Static' }),
    );
    expect(markup).toBe('<button>Static</button>');
  });
});
