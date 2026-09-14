// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { tick } from '../src/index.js';
import { createRoot } from '../src/compat/react/client.js';
import { jsx } from '../src/compat/react/jsx-runtime.js';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from '../src/compat/react-router/index.js';

describe('Workstar React Router source compatibility', () => {
  it('matches nested routes and updates navigation without React', async () => {
    (
      window as Window & { happyDOM: { setURL(url: string): void } }
    ).happyDOM.setURL('https://workstar.test/login');
    const host = document.createElement('div');
    function Workspace() {
      const { tenantId } = useParams<{ tenantId: string }>();
      const [search] = useSearchParams();
      return jsx('section', {
        children: [
          jsx('h1', { children: `Tenant ${tenantId}` }),
          jsx('p', { children: search.get('view') ?? 'overview' }),
          jsx(NavLink, {
            to: '/app/tenants/7',
            end: true,
            children: 'Current',
          }),
        ],
      });
    }
    function Layout() {
      return jsx('main', { children: jsx(Outlet, {}) });
    }
    function App() {
      return jsx(BrowserRouter, {
        children: jsx(Routes, {
          children: [
            jsx(Route, {
              path: '/login',
              element: jsx(Link, {
                to: '/app/tenants/7?view=activity',
                children: 'Open',
              }),
            }),
            jsx(Route, {
              element: jsx(Layout, {}),
              children: jsx(Route, {
                path: '/app/tenants/:tenantId',
                element: jsx(Workspace, {}),
              }),
            }),
            jsx(Route, {
              path: '*',
              element: jsx(Navigate, { to: '/login', replace: true }),
            }),
          ],
        }),
      });
    }
    const root = createRoot(host);
    root.render(jsx(App, {}));
    expect(host.querySelector('a')?.textContent).toBe('Open');
    host.querySelector('a')?.click();
    await tick();
    expect(window.location.pathname).toBe('/app/tenants/7');
    expect(host.querySelector('h1')?.textContent).toBe('Tenant 7');
    expect(host.querySelector('p')?.textContent).toBe('activity');
    expect(host.querySelector('a')?.getAttribute('aria-current')).toBe('page');
    root.unmount();
  });
});
