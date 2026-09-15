import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditForeignDirectory, compileForeignFile } from '../src/project.js';

describe('bundler-independent compatibility compilation', () => {
  it('compiles TSX and Vue sources to typed Workstar modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workstar-compat-cli-'));
    try {
      const reactSource = join(directory, 'Button.tsx');
      const reactOutput = join(directory, 'Button.ts');
      const vueSource = join(directory, 'Badge.vue');
      const vueOutput = join(directory, 'Badge.ts');
      const vueCss = join(directory, 'Badge.css');
      await writeFile(
        reactSource,
        'export default function Button({ label }: { label: string }) { return <button>{label}</button>; }',
      );
      await writeFile(
        vueSource,
        '<script setup lang="ts">defineProps<{ label: string }>()</script><template><p class="badge">{{ label }}</p></template><style scoped>.badge { color: red; }</style>',
      );
      await compileForeignFile(reactSource, reactOutput);
      await compileForeignFile(vueSource, vueOutput, { cssOutputPath: vueCss });
      expect(await readFile(reactOutput, 'utf8')).toContain(
        'export type Props',
      );
      expect(await readFile(reactOutput, 'utf8')).toContain(
        'export function render',
      );
      expect(await readFile(vueOutput, 'utf8')).toContain(
        'export function render',
      );
      expect(await readFile(vueCss, 'utf8')).toContain('color: red');
      expect(
        (await readFile(reactOutput, 'utf8')) +
          (await readFile(vueOutput, 'utf8')),
      ).not.toMatch(/from ['"](?:react|vue)(?:\/|['"])/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves a named TSX component export in generated modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workstar-compat-cli-'));
    try {
      const source = join(directory, 'Loader.tsx');
      const output = join(directory, 'Loader.ts');
      await writeFile(
        source,
        'export function Loader({ label = "Loading" }: { label?: string }) { return <output>{label}</output>; }',
      );
      await compileForeignFile(source, output);
      expect(await readFile(output, 'utf8')).toContain(
        'export { render as Loader };',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('audits a directory without generating files and skips test components', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workstar-compat-audit-'));
    try {
      await mkdir(join(directory, 'ui'));
      await writeFile(
        join(directory, 'ui', 'Loader.tsx'),
        'export function Loader({ label }: { label: string }) { return <output>{label}</output>; }',
      );
      await writeFile(
        join(directory, 'Unsupported.tsx'),
        'import { useState } from "react"; export default function Counter() { const [count] = useState(0); return <p>{count}</p>; }',
      );
      await writeFile(
        join(directory, 'Ignored.test.tsx'),
        'export default function Test() { return <p>test</p>; }',
      );
      const report = await auditForeignDirectory(directory);
      expect(report.total).toBe(2);
      expect(report.supported).toBe(1);
      expect(report.entries).toEqual([
        {
          filename: 'Unsupported.tsx',
          component: 'Counter',
          supported: false,
          reason: expect.stringContaining('imports or module statements'),
          suggestion: expect.stringContaining('runtime compatibility'),
        },
        {
          filename: join('ui', 'Loader.tsx'),
          component: 'Loader',
          supported: true,
        },
      ]);
      expect(report.dependencies).toEqual([
        {
          package: 'react',
          files: ['Unsupported.tsx'],
          handling: 'workstar-runtime-alias',
        },
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rewrites local TSX composition imports for generated modules', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'workstar-compat-tree-'));
    try {
      const source = join(directory, 'source');
      const output = join(directory, 'generated');
      await mkdir(source);
      await mkdir(output);
      await writeFile(
        join(source, 'Child.tsx'),
        'export function Child({ label }: { label: string }) { return <strong>{label}</strong>; }',
      );
      await writeFile(
        join(source, 'Parent.tsx'),
        'import { Child } from "./Child"; export function Parent() { return <div><Child label="Ready" /></div>; }',
      );
      await compileForeignFile(
        join(source, 'Child.tsx'),
        join(output, 'Child.ts'),
      );
      await compileForeignFile(
        join(source, 'Parent.tsx'),
        join(output, 'Parent.ts'),
      );
      const generated = await readFile(join(output, 'Parent.ts'), 'utf8');
      expect(generated).toContain('from "./Child"');
      expect(generated).toContain('Child({label: "Ready"})');
      expect(generated).not.toContain('?workstar');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
