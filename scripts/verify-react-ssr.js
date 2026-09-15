import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { jsx } from '../dist/compat/react/jsx-runtime.js';
import { useId, useState } from '../dist/compat/react/index.js';
import { renderToString } from '../dist/compat/react/server.js';

const repository = resolve(import.meta.dirname, '..');

function ServerApp() {
  const id = useId();
  const [count] = useState(0);
  return jsx('button', { id, onClick: () => {}, children: `Count ${count}` });
}

const client = `
import { hydrateRoot } from '/dist/compat/react/client.js';
import { useId, useState } from '/dist/compat/react/index.js';
import { jsx } from '/dist/compat/react/jsx-runtime.js';
function App() {
  const id = useId();
  const [count, setCount] = useState(0);
  return jsx('button', { id, onClick: () => setCount(value => value + 1), children: 'Count ' + count });
}
const host = document.querySelector('#app');
const serverButton = host.querySelector('button');
hydrateRoot(host, jsx(App, {}));
host.dataset.preserved = String(host.querySelector('button') === serverButton);
host.dataset.hydrated = 'true';
`;

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      `<!doctype html><html><body><div id="app">${renderToString(jsx(ServerApp, {}))}</div><script type="module" src="/client.js"></script></body></html>`,
    );
    return;
  }
  if (pathname === '/client.js') {
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
    });
    response.end(client);
    return;
  }
  const root = resolve(repository, 'dist');
  const file = resolve(repository, pathname.slice(1));
  if (!file.startsWith(`${root}${sep}`) || !file.endsWith('.js')) {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});

let browser;
try {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not start the React SSR verification server.');
  browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('requestfailed', (request) =>
    pageErrors.push(
      `${request.url()}: ${request.failure()?.errorText ?? 'request failed'}`,
    ),
  );
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const host = page.locator('#app[data-hydrated="true"]');
  try {
    await host.waitFor({ timeout: 5000 });
  } catch {
    throw new Error(
      `React-compatible hydration did not start: ${pageErrors.join('; ') || 'no browser error was reported'}`,
    );
  }
  if ((await host.getAttribute('data-preserved')) !== 'true')
    throw new Error('TSX hydration replaced the server-rendered button.');
  await page.locator('button').click();
  await page.locator('button', { hasText: 'Count 1' }).waitFor();
  process.stdout.write('React-compatible SSR and in-place hydration passed.\n');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
