import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createServer as createViteServer } from 'vite';

const repository = resolve(import.meta.dirname, '..');
const vite = await createViteServer({
  root: repository,
  appType: 'custom',
  server: { middlewareMode: true },
});
let server;
let browser;

try {
  const { render } = await vite.ssrLoadModule(
    '/tests/fixtures/hydration-server.ts',
  );
  server = createServer((request, response) => {
    if (request.url !== '/hydration-proof') {
      vite.middlewares(request, response);
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Hydration proof</title></head>
<body><div id="app">${render()}</div>
<script>window.serverButton = document.querySelector('button');</script>
<script type="module" src="/tests/fixtures/hydration-client.ts"></script></body></html>`);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (typeof address !== 'object' || !address?.port)
    throw new Error('Could not start hydration proof server.');
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/hydration-proof`);
  await page.locator('#app[data-hydrated="true"]').waitFor();
  const preserved = await page.evaluate(
    () => window.serverButton === document.querySelector('button'),
  );
  if (!preserved) throw new Error('Hydration replaced the server button.');
  await page.getByRole('button', { name: 'Count is 0' }).click();
  await page.getByRole('button', { name: 'Count is 1' }).waitFor();
  const heading = await page.getByRole('heading', { level: 1 }).textContent();
  if (heading !== 'Server-rendered Workstar')
    throw new Error('Server-rendered content disappeared.');
  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
  });
  try {
    const noScriptPage = await noScriptContext.newPage();
    await noScriptPage.goto(`http://127.0.0.1:${address.port}/hydration-proof`);
    await noScriptPage
      .getByRole('heading', {
        name: 'Server-rendered Workstar',
      })
      .waitFor();
    await noScriptPage.getByRole('button', { name: 'Count is 0' }).waitFor();
  } finally {
    await noScriptContext.close();
  }
  process.stdout.write('SSR and in-place Chromium hydration passed.\n');
} finally {
  await browser?.close();
  await new Promise((done) => server?.close(done) ?? done());
  await vite.close();
}
