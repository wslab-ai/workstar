import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const repository = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'workstar-worker-starter-'));
const project = join(temporary, 'demo');
let worker;
let browser;
let workerOutput = '';

function captureWorkerOutput(chunk) {
  workerOutput = (workerOutput + chunk.toString()).slice(-8_192);
}

function workerStartupError(message) {
  return new Error(
    `${message}\n${workerOutput || 'Worker produced no output.'}`,
  );
}

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
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null || worker.signalCode !== null)
      throw workerStartupError('Worker exited before becoming ready.');
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
    } catch {
      // Wrangler has not bound the port yet.
    }
    if (response?.ok) return;
    if (response && response.status >= 500) {
      throw workerStartupError(
        `Worker returned HTTP ${response.status}: ${(await response.text()).slice(0, 2_000)}`,
      );
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw workerStartupError('Timed out waiting 60 seconds for the Worker.');
}

async function waitForHeading(url, heading) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(url);
    if (response.ok && (await response.text()).includes(`${heading}</h1>`))
      return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Worker did not render the edited heading: ${heading}`);
}

async function waitForStylesheet(url, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(url);
    if (response.ok && (await response.text()).includes(expected)) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Worker did not serve updated component CSS: ${expected}`);
}

try {
  execFileSync(process.execPath, [
    join(repository, 'bin/workstar.js'),
    'create',
    project,
    '--template',
    'worker',
  ]);
  // Package local checkout dependencies so the app and views share one Workstar instance.
  execFileSync('npm', ['install', '--install-links'], {
    cwd: project,
    stdio: 'inherit',
  });
  execFileSync('npm', ['run', 'check'], { cwd: project, stdio: 'inherit' });
  rmSync(join(project, '.workstar'), { recursive: true, force: true });

  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  worker = spawn(
    'npm',
    ['run', 'dev', '--', '--ip', '127.0.0.1', '--port', String(port)],
    { cwd: project, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  worker.stdout.on('data', captureWorkerOutput);
  worker.stderr.on('data', captureWorkerOutput);
  await waitForWorker(origin);

  const sourcePath = join(project, 'src/views/home.workstar');
  const source = readFileSync(sourcePath, 'utf8');
  writeFileSync(
    sourcePath,
    source
      .replace('Ready to build.', 'Live editing works.')
      .replace('max-width: 45ch', 'max-width: 30ch'),
  );
  await waitForHeading(origin, 'Live editing works.');
  await waitForStylesheet(`${origin}/workstar.css`, 'max-width: 30ch');

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
  await page.getByRole('heading', { name: 'Live editing works.' }).waitFor();
  const styled = await page
    .locator('.intro')
    .evaluate((element) => getComputedStyle(element).maxWidth);
  if (styled === 'none')
    throw new Error('Component CSS was not applied in no-JS SSR.');
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
    'Generated Worker starter, live editing, assets, SSR, bounded form, and no-JS browser flow passed.\n',
  );
} finally {
  await browser?.close();
  if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
    if (process.platform === 'win32') worker.kill();
    else process.kill(-worker.pid, 'SIGTERM');
  }
  rmSync(temporary, { recursive: true, force: true });
}
