// @vitest-environment happy-dom

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attr,
  attrs,
  html,
  mount,
  on,
  repeat,
  signal,
  store,
  textareaValue,
} from 'workstar';
import { renderToString } from 'workstar/server';
import { compileComponent } from '../src/index.js';
import { convertReactComponent, convertVueComponent } from '../src/compat.js';

function compiledRenderer(
  source: string,
): (props: Record<string, unknown>) => unknown {
  const compiled = compileComponent(source, 'Converted.workstar');
  const transpiled = ts.transpileModule(compiled, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports: { render?: (props: Record<string, unknown>) => unknown } = {};
  const require = (name: string) => {
    if (name !== 'workstar')
      throw new Error('Unexpected runtime import: ' + name);
    return { attr, attrs, html, on, repeat, signal, store, textareaValue };
  };
  Function('require', 'exports', transpiled.outputText)(require, exports);
  if (!exports.render) throw new Error('Missing Workstar render function.');
  return exports.render;
}

function renderConverted(
  source: string,
  props: Record<string, unknown>,
): string {
  return renderToString(compiledRenderer(source)(props));
}

describe('runtime-free compatibility frontends', () => {
  it('renders a typed React-style TSX component through Workstar', () => {
    const source =
      'interface Props { label: string } export default function Badge({ label }: Props) { return <strong className="badge">{label}</strong>; }';
    const converted = convertReactComponent(source, 'Badge.tsx');
    expect(converted).toContain('export interface Props');
    expect(renderConverted(converted, { label: 'Ready' })).toContain(
      '<strong class="badge">',
    );
    expect(renderConverted(converted, { label: '<unsafe>' })).toContain(
      '&lt;unsafe&gt;',
    );
  });

  it('keeps a React-style click handler interactive without a React runtime', () => {
    const source =
      'export default function Button({ label, onClick }: { label: string; onClick: () => void }) { return <button type="button" onClick={onClick}>{label}</button>; }';
    const converted = convertReactComponent(source, 'Button.tsx');
    const render = compiledRenderer(converted);
    let clicks = 0;
    const host = document.createElement('div');
    const dispose = mount(
      host,
      render({ label: 'Go', onClick: () => clicks++ }),
    );
    host.querySelector('button')?.click();
    expect(clicks).toBe(1);
    dispose();
  });

  it('maps React double-click to the native browser event', () => {
    const converted = convertReactComponent(
      'export default function Button({ onDoubleClick }: { onDoubleClick: () => void }) { return <button onDoubleClick={onDoubleClick}>Open</button>; }',
      'Button.tsx',
    );
    expect(converted).toContain('on:dblclick={onDoubleClick}');
  });

  it('renders a named TSX component with defaults and a computed class', () => {
    const source = readFileSync(
      join(process.cwd(), 'tests/fixtures/named-loader.tsx.txt'),
      'utf8',
    );
    const converted = convertReactComponent(source, 'Loader.tsx');
    expect(renderConverted(converted, { label: 'Loading' })).toContain(
      'class="fixture-loader fixture-loader-medium"',
    );
    expect(
      renderConverted(converted, {
        label: '<loading>',
        size: 'small',
        className: 'custom',
      }),
    ).toContain('class="fixture-loader fixture-loader-small custom"');
    expect(renderConverted(converted, { label: '<loading>' })).toContain(
      '&lt;loading&gt;',
    );
  });

  it('renders a TSX component with safe rest attributes', () => {
    const source = readFileSync(
      join(process.cwd(), 'tests/fixtures/rest-attributes-skeleton.tsx.txt'),
      'utf8',
    );
    const converted = convertReactComponent(source, 'Skeleton.tsx');
    expect(converted).toContain('bind:attrs={__workstarRest}');
    const output = renderConverted(converted, {
      label: 'Loading',
      title: 'Please wait',
    });
    expect(output).toContain('class="fixture-skeleton"');
    expect(output).toContain('title="Please wait"');
    expect(() =>
      renderConverted(converted, {
        label: 'Loading',
        onClick: () => undefined,
      }),
    ).toThrow('unsafe attribute');
  });

  it('renders a typed Vue SFC and scopes its CSS through Workstar', () => {
    const source =
      '<script setup lang="ts">defineProps<{ label: string }>()</script><template><p class="badge">{{ label }}</p></template><style scoped>.badge { color: red; }</style>';
    const converted = convertVueComponent(source, 'Badge.vue');
    expect(converted).toContain('<style>');
    expect(renderConverted(converted, { label: 'Vue source' })).toContain(
      'Vue source',
    );
  });

  it('converts Vue prop bindings and native events without Vue runtime', () => {
    const source =
      '<script setup lang="ts">const props = defineProps<{ label: string; onClick: () => void }>()</script><template><button type="button" :title="props.label" @click="props.onClick">{{ props.label }}</button></template>';
    const converted = convertVueComponent(source, 'Button.vue');
    expect(converted).toContain('title={props.label}');
    expect(converted).toContain('on:click={props.onClick}');
    const compiled = compileComponent(converted, 'Button.workstar');
    expect(compiled).toContain('__on("click", props.onClick)');
    expect(
      renderConverted(converted, { label: 'Open', onClick: () => undefined }),
    ).toContain('title="Open"');
  });

  it('runs a primitive Vue ref through Workstar reactivity', async () => {
    const source =
      '<script setup lang="ts">import { ref } from "vue"; const count = ref(0); function increment() { count.value++; }</script><template><button @click="increment">Count {{ count }}</button></template>';
    const converted = convertVueComponent(source, 'Counter.vue');
    expect(converted).toContain(
      "import { signal as __workstarSignal } from 'workstar'",
    );
    expect(converted).toContain('{count.value}');
    const render = compiledRenderer(converted);
    const host = document.createElement('div');
    const dispose = mount(host, render({}));
    expect(host.textContent).toContain('Count 0');
    host.querySelector('button')?.click();
    await Promise.resolve();
    expect(host.textContent).toContain('Count 1');
    dispose();
  });

  it('runs a flat Vue reactive record through a Workstar store', async () => {
    const source =
      '<script setup lang="ts">import { reactive } from "vue"; const state = reactive({ count: 0, label: "Ready" }); function increment() { state.count++; }</script><template><button :title="state.label" @click="increment">Count {{ state.count }}</button></template>';
    const converted = convertVueComponent(source, 'Counter.vue');
    expect(converted).toContain(
      "import { store as __workstarStore } from 'workstar'",
    );
    const render = compiledRenderer(converted);
    const host = document.createElement('div');
    const dispose = mount(host, render({}));
    expect(host.querySelector('button')?.title).toBe('Ready');
    host.querySelector('button')?.click();
    await Promise.resolve();
    expect(host.textContent).toContain('Count 1');
    dispose();
  });

  it('rejects constructs that need unsupported React or Vue semantics', () => {
    expect(() =>
      convertReactComponent(
        'import { useState } from "react"; export default function Counter() { return <button>0</button>; }',
        'Counter.tsx',
      ),
    ).toThrow('imports or module statements');
    expect(() =>
      convertReactComponent(
        'export default function Button({ click }: { click: () => void }) { return <button onClickCapture={click}>Click</button>; }',
        'Button.tsx',
      ),
    ).toThrow('event onClickCapture');
    expect(() =>
      convertReactComponent(
        'export default function Badge({ label: title }: { label: string }) { return <span>{title}</span>; }',
        'Badge.tsx',
      ),
    ).toThrow('renamed, defaulted, or rest props');
    expect(() =>
      convertVueComponent(
        '<template><p v-if="ready">Ready</p></template>',
        'Conditional.vue',
      ),
    ).toThrow('Vue directive');
    expect(() =>
      convertVueComponent(
        '<template><p :class="classes">Ready</p></template>',
        'Classes.vue',
      ),
    ).toThrow('Vue directive');
    expect(() =>
      convertVueComponent(
        '<template><p title="{{ label }}">Ready</p></template>',
        'Attribute.vue',
      ),
    ).toThrow('unparsed interpolation');
    expect(() =>
      convertVueComponent('<template><slot></slot></template>', 'Slot.vue'),
    ).toThrow('Vue component tag');
    expect(() =>
      convertVueComponent(
        '<template><p ref="element">Ready</p></template>',
        'Ref.vue',
      ),
    ).toThrow('Vue directive');
    expect(() =>
      convertVueComponent(
        '<script setup lang="ts">import { reactive } from "vue"; const state = reactive({ nested: { count: 0 } });</script><template><p>{{ state.nested.count }}</p></template>',
        'State.vue',
      ),
    ).toThrow('flat reactive declaration');
  });
});
