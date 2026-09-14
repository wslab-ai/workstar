import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

const repository = resolve(import.meta.dirname, '..');
const project = await mkdtemp(join(tmpdir(), 'workstar-esbuild-compat-'));

try {
  await symlink(
    join(repository, 'node_modules'),
    join(project, 'node_modules'),
  );
  const entry = join(project, 'main.tsx');
  await writeFile(
    entry,
    `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link } from 'react-router';

function App() {
  const [count, setCount] = useState(0);
  return <BrowserRouter>
    <Link to="/next">Next</Link>
    <button onClick={() => setCount(count + 1)}>{count}</button>
  </BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(<App />);
`,
  );
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: project,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    jsxImportSource: 'workstar/compat/react',
    alias: {
      react: 'workstar/compat/react',
      'react-dom/client': 'workstar/compat/react/client',
      'react-router': 'workstar/compat/react-router',
    },
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  const inputs = Object.keys(result.metafile.inputs);
  assert(inputs.some((name) => name.endsWith('/dist/compat/react/render.js')));
  assert(
    inputs.some((name) => name.endsWith('/dist/compat/react-router/index.js')),
  );
  assert.deepEqual(
    inputs.filter((name) =>
      /[/\\]node_modules[/\\](?:react|react-dom|react-router|vue)(?:[/\\]|$)/.test(
        name,
      ),
    ),
    [],
    'esbuild bundled a foreign framework runtime',
  );
  assert(result.outputFiles[0]?.text.includes('createRoot'));
  process.stdout.write(
    `esbuild bundled unchanged React-style TSX with ${inputs.length} Workstar modules and no React/Vue runtime.\n`,
  );
} finally {
  await rm(project, { recursive: true, force: true });
}
