import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

function startViteServer(projectDirectory, command, port) {
  return spawn(
    process.execPath,
    [
      join(projectDirectory, 'node_modules/vite/bin/vite.js'),
      command,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: projectDirectory, stdio: 'ignore' },
  );
}

// A visible update can precede completion of the previous watch cycle.
const settleWatcher = () => new Promise((done) => setTimeout(done, 500));

try {
  execFileSync(process.execPath, [
    join(repository, 'bin/workstar.js'),
    'create',
    project,
  ]);
  const panelFixturePath = join(project, 'src/views/panel.workstar');
  const panelFixture = readFileSync(panelFixturePath, 'utf8');
  writeFileSync(
    panelFixturePath,
    panelFixture
      .replace(
        "import type { Template } from 'workstar';",
        "import { signal, type Template } from 'workstar';\n  const nestedCount = signal(0);",
      )
      .replace(
        '</section>',
        '<button type="button" on:click="{incrementNested}">Nested {nestedCount.value}</button>\n</section>',
      )
      .replace(
        'const nestedCount = signal(0);',
        'const nestedCount = signal(0);\n  function incrementNested() { nestedCount.update((value) => value + 1); }',
      ),
  );
  execFileSync('npm', ['install'], {
    cwd: project,
    stdio: 'inherit',
  });
  execFileSync(
    'npm',
    ['exec', '--', 'prettier', '--write', 'src/views/panel.workstar'],
    {
      cwd: project,
      stdio: 'inherit',
    },
  );
  execFileSync('npm', ['run', 'format:check'], {
    cwd: project,
    stdio: 'inherit',
  });
  execFileSync('npm', ['run', 'check'], { cwd: project, stdio: 'inherit' });
  execFileSync('npm', ['run', 'format:check'], {
    cwd: project,
    stdio: 'inherit',
  });
  execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'inherit' });
  if (!existsSync(join(project, 'dist/index.html')))
    throw new Error('Starter did not build.');

  const port = await availablePort();
  const url = `http://127.0.0.1:${port}/`;
  preview = startViteServer(project, 'preview', port);
  await waitForPreview(url);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const componentStyle = await page
    .locator('.card')
    .evaluate((element) =>
      getComputedStyle(element)
        .getPropertyValue('--component-css-ready')
        .trim(),
    );
  if (componentStyle !== 'yes') {
    throw new Error('Production build omitted co-located component CSS.');
  }
  await page.getByRole('button', { name: 'Clicked 0 times' }).click();
  const button = page.getByRole('button', { name: 'Clicked 1 times' });
  await button.waitFor();
  if (!(await button.textContent())?.includes('Clicked 1 times')) {
    throw new Error('Starter button did not update in a browser.');
  }
  preview.kill();
  await new Promise((done) => preview.once('exit', done));

  rmSync(join(project, '.workstar'), { recursive: true, force: true });
  const devPort = await availablePort();
  const devUrl = `http://127.0.0.1:${devPort}/`;
  preview = startViteServer(project, 'dev', devPort);
  await waitForPreview(devUrl);
  await page.goto(devUrl);
  await page
    .getByRole('heading', { name: 'Build with less ceremony.' })
    .waitFor();
  await page.getByRole('button', { name: 'Clicked 0 times' }).click();
  await page.getByRole('button', { name: 'Nested 0' }).click();
  const panelPath = join(project, 'src/views/panel.workstar');
  const panelBeforeStyleEdit = readFileSync(panelPath, 'utf8');
  writeFileSync(
    panelPath,
    panelBeforeStyleEdit.replace(
      '--component-css-ready: yes',
      '--component-css-ready: hmr',
    ),
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.card'))
        .getPropertyValue('--component-css-ready')
        .trim() === 'hmr',
  );
  await page.getByRole('button', { name: 'Clicked 1 times' }).waitFor();
  await settleWatcher();
  const sourcePath = join(project, 'src/views/app.workstar');
  const source = readFileSync(sourcePath, 'utf8').replace(
    '<button type="button"',
    '<input aria-label="Draft" type="text" />\n  <button type="button"',
  );
  writeFileSync(sourcePath, source);
  await page.getByRole('textbox', { name: 'Draft' }).fill('Unsent note');
  await page.getByRole('button', { name: 'Clicked 1 times' }).click();
  await page.evaluate(() => {
    window.__workstarHmrMarker = true;
  });
  writeFileSync(
    sourcePath,
    source.replace('Build with less ceremony.', 'Edit and see the result.'),
  );
  await page
    .getByRole('heading', { name: 'Edit and see the result.' })
    .waitFor();
  await page.getByRole('button', { name: 'Clicked 2 times' }).waitFor();
  await page.getByRole('button', { name: 'Nested 1' }).waitFor();
  if (
    (await page.getByRole('textbox', { name: 'Draft' }).inputValue()) !==
    'Unsent note'
  ) {
    throw new Error('Markup HMR discarded an unfinished form value.');
  }
  if (!(await page.evaluate(() => window.__workstarHmrMarker))) {
    throw new Error('Markup edit triggered a full page navigation.');
  }
  await settleWatcher();
  writeFileSync(
    sourcePath,
    source.replace('{count.value}', '{count.value + 1}'),
  );
  await page.locator('vite-error-overlay').waitFor();
  await settleWatcher();
  writeFileSync(
    sourcePath,
    source.replace('Build with less ceremony.', 'Recovered after an error.'),
  );
  await page
    .getByRole('heading', { name: 'Recovered after an error.' })
    .waitFor();
  if (existsSync(join(project, '.workstar'))) {
    throw new Error('Vite should not write generated modules to the project.');
  }

  preview.kill();
  await new Promise((done) => preview.once('exit', done));

  const nestedDirectory = join(project, 'src/views/components');
  const originalPanel = join(project, 'src/views/panel.workstar');
  const nestedPanel = join(nestedDirectory, 'panel.workstar');
  const panelSource = readFileSync(originalPanel, 'utf8');
  mkdirSync(nestedDirectory, { recursive: true });
  writeFileSync(
    nestedPanel,
    panelSource.replace('class="card"', 'class="card nested-card"'),
  );
  rmSync(originalPanel);
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, 'utf8').replace(
      './panel.workstar',
      './components/panel.workstar',
    ),
  );
  preview = startViteServer(project, 'dev', devPort);
  await waitForPreview(devUrl);
  await page.goto(devUrl);
  await page.locator('.nested-card').waitFor();
  await page.getByRole('button', { name: 'Nested 0' }).click();
  await page.getByRole('button', { name: 'Nested 1' }).waitFor();
  await page.evaluate(() => {
    window.__workstarHmrMarker = 'nested';
  });
  writeFileSync(
    nestedPanel,
    readFileSync(nestedPanel, 'utf8').replace(
      '--component-css-ready: hmr',
      '--component-css-ready: updated',
    ),
  );
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.nested-card'))
        .getPropertyValue('--component-css-ready')
        .trim() === 'updated',
  );
  await settleWatcher();
  await page.getByRole('textbox', { name: 'Draft' }).fill('Nested draft');
  writeFileSync(
    nestedPanel,
    panelSource
      .replace('class="card"', 'class="card nested-card--edited"')
      .replace('--component-css-ready: hmr', '--component-css-ready: updated'),
  );
  await page.locator('.nested-card--edited').waitFor();
  if (!(await page.getByRole('button', { name: 'Nested 1' }).isVisible())) {
    const visibleText = await page.locator('.nested-card--edited').innerText();
    const marker = await page.evaluate(() => window.__workstarHmrMarker);
    throw new Error(`Nested HMR lost state: ${visibleText}; marker=${marker}`);
  }
  if (
    (await page.getByRole('textbox', { name: 'Draft' }).inputValue()) !==
    'Nested draft'
  ) {
    throw new Error(
      'Nested component edit discarded an unfinished form value.',
    );
  }
  preview.kill();
  await new Promise((done) => preview.once('exit', done));

  renameSync(join(project, 'src/views'), join(project, 'src/ui'));
  const entryPath = join(project, 'src/main.ts');
  writeFileSync(
    entryPath,
    readFileSync(entryPath, 'utf8').replace(
      './views/app.workstar',
      './ui/app.workstar',
    ),
  );
  execFileSync('npm', ['run', 'check'], { cwd: project, stdio: 'inherit' });
  execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'inherit' });
  if (
    existsSync(join(project, '.workstar/generated/views/app.ts')) ||
    !existsSync(join(project, '.workstar/generated/ui/app.ts')) ||
    !existsSync(join(project, '.workstar/generated/ui/components/panel.ts'))
  ) {
    throw new Error('Obsolete generated view was not removed.');
  }
  process.stdout.write(
    'Starter build, interaction, live editing, nested components, arbitrary source folder, and error recovery passed.\n',
  );
} finally {
  await browser?.close();
  preview?.kill();
  rmSync(temporary, { recursive: true, force: true });
}
