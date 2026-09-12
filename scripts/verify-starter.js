import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const repository = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'workstar-starter-'));
const project = join(temporary, 'demo');
let preview;
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

async function waitForPreview(url) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (preview.exitCode !== null)
      throw new Error('Preview server exited before becoming ready.');
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite has not bound the port yet.
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Timed out waiting for the starter preview.');
}

try {
  execFileSync(process.execPath, [
    join(repository, 'bin/workstar.js'),
    'create',
    project,
  ]);
  execFileSync('npm', ['install', '--legacy-peer-deps', `file:${repository}`], {
    cwd: project,
    stdio: 'inherit',
  });
  execFileSync('npm', ['run', 'check'], { cwd: project, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'inherit' });
  if (!existsSync(join(project, 'dist/index.html')))
    throw new Error('Starter did not build.');

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/`;
  preview = spawn(
    'npm',
    [
      'run',
      'preview',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: project,
      stdio: 'ignore',
    },
  );
  await waitForPreview(url);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: 'Count is 0' }).click();
  const button = page.getByRole('button', { name: 'Count is 1' });
  await button.waitFor();
  if (!(await button.textContent())?.includes('Clicked 1 times')) {
    throw new Error('Starter button did not update in a browser.');
  }
  process.stdout.write('Starter build and browser interaction passed.\n');
} finally {
  await browser?.close();
  preview?.kill();
  rmSync(temporary, { recursive: true, force: true });
}
