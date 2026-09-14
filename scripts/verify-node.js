import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const repository = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'workstar-node-starter-'));
const project = join(temporary, 'demo');
let server;
let browser;

async function availablePort() {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const address = socket.address();
  const port = typeof address === 'object' ? address?.port : undefined;
  await new Promise((done) => socket.close(done));
  if (!port) throw new Error('Could not reserve a local port.');
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error('Node starter exited before becoming ready.');
    }
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The server has not bound the port yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Timed out waiting for the Node starter.');
}

try {
  execFileSync(process.execPath, [
    join(repository, 'bin/workstar.js'),
    'create',
    project,
    '--template',
    'node',
  ]);
  // Package local checkout dependencies so the app and views share one Workstar instance.
  execFileSync(
    'npm',
    ['install', '--install-links', '--no-audit', '--no-fund'],
    {
      cwd: project,
      stdio: 'inherit',
    },
  );
  execFileSync('npm', ['run', 'check'], { cwd: project, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'inherit' });

  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['dist/src/server.js'], {
    cwd: project,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: 'ignore',
  });
  await waitForServer(origin);

  const home = await fetch(origin);
  const html = await home.text();
  if (
    !html.includes('<h1') ||
    !html.includes('Server-rendered by default.</h1>')
  ) {
    throw new Error('Node starter did not serve server-rendered markup.');
  }
  const css = await fetch(`${origin}/workstar.css`);
  if (!css.ok || !(await css.text()).includes('data-workstar-')) {
    throw new Error('Node starter did not serve component CSS.');
  }
  const head = await fetch(`${origin}/workstar.css`, { method: 'HEAD' });
  if (!head.ok || (await head.text()) !== '') {
    throw new Error('Node starter did not serve a bodyless CSS HEAD response.');
  }
  const oversized = await fetch(`${origin}/contact`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'x'.repeat(10_000) }),
  });
  if (oversized.status !== 413) {
    throw new Error(`Oversized form returned ${oversized.status}, not 413.`);
  }

  browser = await chromium.launch();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByLabel('Your name').fill('Ada');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByRole('heading', { name: 'Thanks for trying Workstar.' })
    .waitFor();
  if (new URL(page.url()).pathname !== '/thanks') {
    throw new Error('No-JavaScript Node form did not redirect.');
  }
  process.stdout.write(
    'Node.js starter SSR, CSS, bounded form, and no-JavaScript browser flow passed.\n',
  );
} finally {
  await browser?.close();
  if (server?.pid && server.exitCode === null && server.signalCode === null) {
    server.kill();
  }
  rmSync(temporary, { recursive: true, force: true });
}
