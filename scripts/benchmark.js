import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { compileComponentParts } from '../packages/compiler/dist/src/index.js';
import { html } from '../dist/index.js';
import { renderToString } from '../dist/server.js';

const repository = resolve(import.meta.dirname, '..');
const iterations = {
  compile: 100,
  ssr: 500,
  mount: 100,
  update: 200,
  hydrate: 100,
  compatibilityListUpdate: 200,
  compatibilityListReorder: 20,
};
const compatibilityRows = 1000;
const rounds = 5;

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return Number(ordered[Math.floor(ordered.length / 2)].toFixed(3));
}

function measure(iterationCount, run) {
  const samples = [];
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    for (let index = 0; index < iterationCount; index++) run(index);
    samples.push(performance.now() - start);
  }
  return median(samples);
}

const source = await readFile(
  resolve(repository, 'templates/basic/src/views/app.workstar'),
  'utf8',
);
const compileMs = measure(iterations.compile, () =>
  compileComponentParts(source, '/benchmark/app.workstar'),
);
const serverView = html`<button>Count ${0}</button>`;
const serverMarkup = renderToString(serverView);
const ssrMs = measure(iterations.ssr, () => renderToString(serverView));

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<!doctype html><html><body><div id="host"></div></body></html>',
    );
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
    throw new Error('No benchmark port.');
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`);
  const browserMetrics = await page.evaluate(
    async ({ markup, iterations, rounds, compatibilityRows }) => {
      const { html, mount, hydrate, signal, tick } =
        await import('/dist/index.js');
      const host = document.querySelector('#host');
      if (!host) throw new Error('Missing benchmark host.');
      const median = (values) => {
        const ordered = [...values].sort((a, b) => a - b);
        return Number(ordered[Math.floor(ordered.length / 2)].toFixed(3));
      };
      const mountSamples = [];
      for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        for (let index = 0; index < iterations.mount; index++) {
          const element = document.createElement('div');
          host.append(element);
          const dispose = mount(element, html`<button>Count ${index}</button>`);
          dispose();
          element.remove();
        }
        mountSamples.push(performance.now() - start);
      }

      const count = signal(0);
      const dispose = mount(host, html`<button>Count ${count}</button>`);
      const updateSamples = [];
      for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        for (let index = 0; index < iterations.update; index++) {
          count.value = index + round * iterations.update;
          await tick();
        }
        updateSamples.push(performance.now() - start);
      }
      dispose();

      const hydrationSamples = [];
      for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        for (let index = 0; index < iterations.hydrate; index++) {
          host.innerHTML = markup;
          const value = signal(0);
          const detach = hydrate(host, html`<button>Count ${value}</button>`);
          detach();
        }
        hydrationSamples.push(performance.now() - start);
      }
      const [{ createRoot }, react, jsxRuntime] = await Promise.all([
        import('/dist/compat/react/client.js'),
        import('/dist/compat/react/index.js'),
        import('/dist/compat/react/jsx-runtime.js'),
      ]);
      let updateTarget;
      let reorderRows;
      let rowRenders = 0;
      const Row = react.memo(function BenchmarkRow({ index }) {
        const [value, setValue] = react.useState(0);
        rowRenders++;
        if (index === Math.floor(compatibilityRows / 2))
          updateTarget = () => setValue((current) => current + 1);
        return jsxRuntime.jsx('tr', {
          children: jsxRuntime.jsx('td', { children: `${index}:${value}` }),
        });
      });
      function Table() {
        const [rows, setRows] = react.useState(() =>
          Array.from({ length: compatibilityRows }, (_, index) => index),
        );
        reorderRows = () => setRows((current) => [...current].reverse());
        return jsxRuntime.jsx('table', {
          children: jsxRuntime.jsx('tbody', {
            children: rows.map((index) =>
              jsxRuntime.jsx(Row, { index }, index),
            ),
          }),
        });
      }
      const compatibilityRoot = createRoot(host);
      compatibilityRoot.render(jsxRuntime.jsx(Table, {}));
      const initialRowRenders = rowRenders;
      const compatibilityListSamples = [];
      for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        for (
          let index = 0;
          index < iterations.compatibilityListUpdate;
          index++
        ) {
          updateTarget();
          await tick();
        }
        compatibilityListSamples.push(performance.now() - start);
      }
      const expectedUpdatedRowRenders =
        rounds * iterations.compatibilityListUpdate;
      if (
        initialRowRenders !== compatibilityRows ||
        rowRenders - initialRowRenders !== expectedUpdatedRowRenders
      )
        throw new Error('A local keyed-list update rendered unrelated rows.');
      const compatibilityReorderSamples = [];
      for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        for (
          let index = 0;
          index < iterations.compatibilityListReorder;
          index++
        ) {
          reorderRows();
          await tick();
        }
        compatibilityReorderSamples.push(performance.now() - start);
      }
      if (rowRenders - initialRowRenders !== expectedUpdatedRowRenders)
        throw new Error('Reordering a memoized keyed list rendered its rows.');
      compatibilityRoot.unmount();
      return {
        mountMs: median(mountSamples),
        updateMs: median(updateSamples),
        hydrateMs: median(hydrationSamples),
        compatibilityListUpdateMs: median(compatibilityListSamples),
        compatibilityListReorderMs: median(compatibilityReorderSamples),
        compatibilityRows,
        compatibilityInitialRowRenders: initialRowRenders,
        compatibilityUpdatedRowRenders: rowRenders - initialRowRenders,
      };
    },
    { markup: serverMarkup, iterations, rounds, compatibilityRows },
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        note: 'Median elapsed milliseconds per batch; lower is better. No cross-framework comparison.',
        node: process.version,
        browser: browser.version(),
        platform: `${process.platform}/${process.arch}`,
        rounds,
        iterations,
        compileMs,
        ssrMs,
        ...browserMetrics,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
