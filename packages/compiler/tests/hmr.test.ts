// @vitest-environment happy-dom

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  attr,
  html,
  mount,
  on,
  repeat,
  signal,
  textareaValue,
  tick,
} from 'workstar';
import { createHotContext } from 'workstar/dev';
import { compileComponent } from '../src/index.js';

describe('development component state', () => {
  it('retains directly imported signals only in development output', () => {
    const source = `<script lang="ts">
import { signal as makeSignal } from 'workstar';
const count = makeSignal(0);
</script>
<button>{count.value}</button>`;
    const release = compileComponent(source);
    const development = compileComponent(source, 'Counter.workstar', {
      hotState: true,
    });
    expect(release).not.toContain('__context');
    expect(development).toContain('count:makeSignal(0)');
    expect(development).toContain(
      "import type { HotContext as __WorkstarHotContext } from 'workstar/dev'",
    );
  });

  it('uses keyed identities for development state in repeated components', () => {
    const source = `<script lang="ts">
import Counter from './counter.workstar';
export interface Props { rows: Array<{ id: string }> }
</script>
<Each each="{rows}" as="row" key="id">
  <Use component="{Counter}" />
</Each>`;
    const development = compileComponent(source, 'List.workstar', {
      hotState: true,
    });
    expect(development).toMatch(
      /\.child\('each:\d+'\)\?\.child\(row\.value\.id\)/,
    );
    expect(development).toMatch(/\.child\('use:\d+'\)/);
  });

  it('keeps local signals isolated across repeated component instances', async () => {
    const source = `<script lang="ts">
import Counter from './counter.workstar';
export interface Props { rows: Array<{ id: string }> }
</script>
<Each each="{rows}" as="row" key="id">
  <Use component="{Counter}" id="{row.id}" />
</Each>`;
    const generated = compileComponent(source, 'List.workstar', {
      hotState: true,
    });
    const output = ts.transpileModule(generated, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    });
    const exports: {
      render?: (
        props: { rows: Array<{ id: string }> },
        context: ReturnType<typeof createHotContext>,
      ) => unknown;
    } = {};
    const Counter = (
      props: { id: string },
      context: ReturnType<typeof createHotContext>,
    ) => {
      const count = context.state('count', () => signal(0));
      return html`<button
        ${on('click', () => count.update((value) => value + 1))}
      >
        ${props.id}: ${count}
      </button>`;
    };
    const require = (name: string) => {
      if (name === 'workstar') return { html, attr, on, repeat, textareaValue };
      if (name === './counter') return { render: Counter };
      throw new Error(`Unexpected import: ${name}`);
    };
    Function('require', 'exports', output.outputText)(require, exports);
    const context = createHotContext();
    const props = { rows: [{ id: 'a' }, { id: 'b' }] };
    const host = document.createElement('div');
    mount(host, exports.render!(props, context));
    host.querySelector('button')!.click();
    await tick();
    mount(host, exports.render!(props, context));
    expect(
      Array.from(host.querySelectorAll('button'), (button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(['a: 1', 'b: 0']);
  });
});
