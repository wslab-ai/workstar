import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const project = resolve(import.meta.dirname, '../templates/worker');
let worker;
let browser;

async function availablePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' ? address?.port : undefined;
  await new Promise((done) => server.close(done));
  if (!port) throw new Error('Could not find a free local port.');
  return port;
}

async function waitForWorker(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (worker.exitCode !== null)
      throw new Error('Worker exited before becoming ready.');
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Wrangler has not bound the port yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Timed out waiting for the Worker.');
}

try {
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  worker = spawn(
    'npx',
    ['wrangler', 'dev', '--local', '--ip', '127.0.0.1', '--port', String(port)],
    { cwd: project, stdio: 'ignore' },
  );
  await waitForWorker(origin);

  const stylesheet = await fetch(`${origin}/style.css`);
  if (
    !stylesheet.ok ||
    !stylesheet.headers.get('content-type')?.includes('text/css')
  ) {
    throw new Error('Cloudflare did not serve the stylesheet asset.');
  }

  browser = await chromium.launch();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Ready to build.' }).waitFor();
  await page.getByRole('link', { name: 'Contact us' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ada');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('heading', { name: 'Thank you.' }).waitFor();
  if (new URL(page.url()).pathname !== '/thanks') {
    throw new Error('No-JavaScript form action did not redirect.');
  }

  const tooLarge = await fetch(`${origin}/contact`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'x'.repeat(10_000) }),
  });
  if (tooLarge.status !== 413) {
    throw new Error(
      `Oversized form returned ${tooLarge.status}, expected 413.`,
    );
  }
  process.stdout.write(
    'Worker assets, SSR, bounded form, and no-JS browser flow passed.\n',
  );
} finally {
  await browser?.close();
  worker?.kill();
}
