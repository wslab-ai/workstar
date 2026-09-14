import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { workstar } from '../src/vite.js';

const coreSource = fileURLToPath(
  new URL('../../../src/index.ts', import.meta.url),
);

describe('Vite foreign component imports', () => {
  it('builds TSX and Vue sources into a Workstar-only bundle', async () => {
    const project = await mkdtemp(join(tmpdir(), 'workstar-compat-'));
    const source = join(project, 'src');
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(source);
      await Promise.all([
        writeFile(
          join(project, 'index.html'),
          '<div id="app"></div><script type="module" src="/src/main.ts"></script>',
        ),
        writeFile(
          join(source, 'main.ts'),
          "import { mount } from 'workstar'; import { render } from './app.workstar'; mount(document.querySelector('#app')!, render({}));",
        ),
        writeFile(
          join(source, 'app.workstar'),
          '<script lang="ts">import Button from "./Button.tsx?workstar"; import { Loader } from "./Loader.tsx?workstar"; import { Wrapper } from "./Wrapper.tsx?workstar"; import Badge from "./Badge.vue?workstar"; function click() {}</script><main><Use component={Button} label="Go" onClick={click} /><Use component={Loader} label="Loading" /><Use component={Wrapper} title="Nested" /><Use component={Badge} label="Vue" /></main>',
        ),
        writeFile(
          join(source, 'Button.tsx'),
          'export default function Button({ label, onClick }: { label: string; onClick: () => void }) { return <button onClick={onClick}>{label}</button>; }',
        ),
        writeFile(
          join(source, 'Loader.tsx'),
          'export function Loader({ label, size = "medium" }: { label: string; size?: string }) { return <output className={`loader-${size}`.trim()}>{label}</output>; }',
        ),
        writeFile(
          join(source, 'Wrapper.tsx'),
          'import { Loader } from "./Loader"; export function Wrapper({ title }: { title: string }) { return <section><Loader label={title} /></section>; }',
        ),
        writeFile(
          join(source, 'Badge.vue'),
          '<script setup lang="ts">defineProps<{ label: string }>()</script><template><p class="badge">{{ label }}</p></template><style scoped>.badge { color: red; }</style>',
        ),
      ]);
      const result = await build({
        root: project,
        configFile: false,
        plugins: [workstar()],
        resolve: { alias: { workstar: coreSource } },
        build: { write: false },
        logLevel: 'silent',
      });
      if (!('output' in result))
        throw new Error('Expected one Vite build output.');
      const javascript = result.output
        .filter((asset) => asset.type === 'chunk')
        .map((asset) => asset.code)
        .join('\n');
      const css = result.output
        .filter(
          (asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'),
        )
        .map((asset) => (asset.type === 'asset' ? String(asset.source) : ''))
        .join('\n');
      expect(javascript).toContain('badge');
      expect(javascript).toContain('loader-');
      expect(javascript).toContain('Nested');
      expect(css).toMatch(/color:\s*red/);
      expect(javascript).not.toMatch(
        /(?:from|require\()\s*['"](?:react|vue)(?:\/|['"])/,
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it('builds an unchanged TSX component tree with ordinary imports', async () => {
    const project = await mkdtemp(join(tmpdir(), 'workstar-compat-auto-'));
    const source = join(project, 'src');
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(source);
      await Promise.all([
        writeFile(
          join(project, 'index.html'),
          '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
        ),
        writeFile(
          join(source, 'main.tsx'),
          "import { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import { App } from './App'; const root = document.getElementById('root'); if (!root) throw new Error('Missing root'); createRoot(root).render(<StrictMode><App /></StrictMode>);",
        ),
        writeFile(
          join(source, 'App.tsx'),
          'import { Label } from "./Label"; export function App() { return <section><Label text="Ready" /></section>; }',
        ),
        writeFile(
          join(source, 'Label.tsx'),
          'export function Label({ text }: { text: string }) { return <strong>{text}</strong>; }',
        ),
      ]);
      const result = await build({
        root: project,
        configFile: false,
        plugins: [workstar({ foreign: 'automatic' })],
        resolve: { alias: { workstar: coreSource } },
        build: { write: false },
        logLevel: 'silent',
      });
      if (!('output' in result))
        throw new Error('Expected one Vite build output.');
      const javascript = result.output
        .filter((asset) => asset.type === 'chunk')
        .map((asset) => asset.code)
        .join('\n');
      expect(javascript).toContain('Ready');
      expect(javascript).toContain('strong');
      expect(javascript).not.toMatch(
        /(?:from|require\()\s*['"](?:react|vue)(?:\/|['"])/,
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it('resolves the default React runtime aliases from installed Workstar packages', async () => {
    const project = await mkdtemp(join(tmpdir(), 'workstar-react-runtime-'));
    const source = join(project, 'src');
    try {
      await mkdir(source);
      await symlink(
        fileURLToPath(new URL('../../../node_modules', import.meta.url)),
        join(project, 'node_modules'),
      );
      await Promise.all([
        writeFile(
          join(project, 'index.html'),
          '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
        ),
        writeFile(
          join(source, 'main.tsx'),
          "import { useState } from 'react'; import { createRoot } from 'react-dom/client'; import { BrowserRouter, Link } from 'react-router'; function App() { const [count, setCount] = useState(0); return <BrowserRouter><Link to='/next'>Next</Link><button onClick={() => setCount(count + 1)}>{count}</button></BrowserRouter>; } createRoot(document.getElementById('root')!).render(<App />);",
        ),
      ]);
      const result = await build({
        root: project,
        configFile: false,
        plugins: [workstar({ foreign: 'runtime' })],
        build: { write: false },
        logLevel: 'silent',
      });
      if (!('output' in result))
        throw new Error('Expected one Vite build output.');
      const modules = result.output.flatMap((asset) =>
        asset.type === 'chunk' ? Object.keys(asset.modules) : [],
      );
      expect(
        modules.some((name) => name.endsWith('/compat/react/render.js')),
      ).toBe(true);
      expect(
        modules.some((name) => name.endsWith('/compat/react-router/index.js')),
      ).toBe(true);
      expect(modules).not.toContainEqual(
        expect.stringMatching(
          /[/\\]node_modules[/\\](?:react|react-dom|react-router|vue)(?:[/\\]|$)/,
        ),
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
