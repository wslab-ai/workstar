import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, firefox, webkit } from '@playwright/test';
import { build, preview } from 'vite';
import { workstar } from '../packages/compiler/dist/src/vite.js';

const repository = resolve(import.meta.dirname, '..');
const project = await mkdtemp(join(tmpdir(), 'workstar-react-runtime-vite-'));
const config = {
  root: project,
  configFile: false,
  cacheDir: join(project, '.vite-cache'),
  plugins: [
    workstar({
      foreign: 'runtime',
      runtimeImportSource: join(repository, 'dist/compat/react'),
    }),
  ],
  build: { outDir: join(project, 'dist'), emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 0 },
  logLevel: 'silent',
};

function bundledModules(result) {
  const builds = Array.isArray(result) ? result : [result];
  return builds.flatMap((buildResult) =>
    buildResult.output.flatMap((asset) =>
      asset.type === 'chunk' ? Object.keys(asset.modules) : [],
    ),
  );
}

let server;
try {
  await Promise.all([
    writeFile(
      join(project, 'index.html'),
      '<div id="app"></div><script type="module" src="/main.tsx"></script>',
    ),
    writeFile(
      join(project, 'main.tsx'),
      `import { createContext, useContext, useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Outlet, Route, Routes, useParams } from 'react-router';

const Label = createContext('missing');

function Counter() {
  const [count, setCount] = useState(0);
  return <button id="count" onClick={() => setCount(count + 1)}>{useContext(Label)} {count}</button>;
}

function Home() {
  const draftId = useId();
  const [rows, setRows] = useState(['alpha', 'beta']);
  return <main>
    <svg id="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M2 2L22 22" /><circle cx={12} cy={12} r={3} />
    </svg>
    <label htmlFor={draftId}>Draft</label><input id={draftId} defaultValue="" />
    <Counter />
    <button id="reverse" onClick={() => setRows((current) => [...current].reverse())}>Reverse</button>
    <ul>{rows.map((row) => <li key={row}><input aria-label={row} defaultValue="" /></li>)}</ul>
  </main>;
}

function DetailLayout() {
  return <section id="detail-layout"><Outlet /></section>;
}

function Detail() {
  const { id } = useParams();
  return <p id="detail">Detail {id}</p>;
}

function App() {
  return <Label.Provider value="Workstar"><BrowserRouter>
    <nav><Link to="/">Home</Link><Link to="/detail/42">Details</Link></nav>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/detail" element={<DetailLayout />}><Route path=":id" element={<Detail />} /></Route>
    </Routes>
  </BrowserRouter></Label.Provider>;
}

createRoot(document.getElementById('app')).render(<App />);
`,
    ),
  ]);

  const modules = bundledModules(await build(config));
  assert(modules.length > 5, 'Expected a bundled application');
  assert.deepEqual(
    modules.filter((name) =>
      /[/\\]node_modules[/\\](?:react|react-dom|react-router|vue)(?:[/\\]|$)/.test(
        name,
      ),
    ),
    [],
    'Vite bundled a foreign framework runtime',
  );

  server = await preview(config);
  const base = server.resolvedUrls.local[0];
  assert(base, 'Vite did not expose the application preview');
  for (const browserType of [chromium, firefox, webkit]) {
    const browser = await browserType.launch();
    try {
      const page = await browser.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      await page.goto(base);
      await page.locator('#count', { hasText: 'Workstar 0' }).waitFor();
      const icon = await page.locator('#icon').evaluate((element) => ({
        namespaces: [...element.children].map((child) => child.namespaceURI),
        strokeWidth: getComputedStyle(element).strokeWidth,
      }));
      assert.deepEqual(icon.namespaces, [
        'http://www.w3.org/2000/svg',
        'http://www.w3.org/2000/svg',
      ]);
      assert.equal(icon.strokeWidth, '2px');
      const draft = page.getByRole('textbox', { name: 'Draft' });
      await draft.fill('unfinished');
      const draftElement = await draft.elementHandle();
      const beta = page.getByRole('textbox', { name: 'beta' });
      await beta.fill('retained row');
      const betaElement = await beta.elementHandle();
      await page.locator('#count').click();
      await page.locator('#count', { hasText: 'Workstar 1' }).waitFor();
      assert.equal(await draft.inputValue(), 'unfinished');
      assert(
        await draft.evaluate(
          (element, original) => element === original,
          draftElement,
        ),
        'A sibling state update replaced the draft field',
      );
      await page.locator('#reverse').click();
      assert.equal(
        await page.locator('li').first().getByRole('textbox').inputValue(),
        'retained row',
      );
      assert(
        await beta.evaluate(
          (element, original) => element === original,
          betaElement,
        ),
        'Reordering a keyed row replaced its field',
      );
      await page.getByRole('link', { name: 'Details' }).click();
      await page.locator('#detail', { hasText: 'Detail 42' }).waitFor();
      await page.locator('#detail-layout').waitFor();
      assert.equal(new URL(page.url()).pathname, '/detail/42');
      assert.deepEqual(
        pageErrors,
        [],
        `${browserType.name()} reported uncaught errors`,
      );
    } finally {
      await browser.close();
    }
  }
  process.stdout.write(
    `Vite runtime compatibility passed in Chromium, Firefox, and WebKit: retained forms and keyed rows, state, context, nested routing, and ${modules.length} bundled modules without React/Vue.\n`,
  );
} finally {
  if (server)
    await new Promise((done, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : done())),
    );
  await rm(project, { recursive: true, force: true });
}
