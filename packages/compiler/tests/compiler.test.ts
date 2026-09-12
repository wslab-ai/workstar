// @vitest-environment happy-dom

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  attr,
  html,
  hydrate,
  on,
  repeat,
  signal,
  textareaValue,
  tick,
} from 'workstar';
import { renderToString } from 'workstar/server';
import { compileComponent, compileComponentParts } from '../src/index.js';

function evaluate(
  source: string,
  dependencies: Record<string, unknown> = {},
): (props: Record<string, unknown>) => unknown {
  const generated = compileComponent(source, 'Example.workstar');
  const transpiled = ts.transpileModule(generated, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  expect(transpiled.diagnostics ?? []).toEqual([]);
  const exports: { render?: (props: Record<string, unknown>) => unknown } = {};
  const require = (name: string) => {
    if (name === 'workstar')
      return { html, attr, on, repeat, signal, textareaValue };
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected import: ${name}`);
  };
  Function('require', 'exports', transpiled.outputText)(require, exports);
  if (!exports.render) throw new Error('Missing render function.');
  return exports.render;
}

describe('component compiler', () => {
  it('scopes co-located CSS and keeps the same markup for SSR and hydration', () => {
    const source = `<main class="card"><p class="intro">Hello</p></main>
<style>
  .card > .intro:hover { color: red; }
  @media (max-width: 40rem) { .intro::before { content: '→'; } }
</style>`;
    const { code, css } = compileComponentParts(source, 'Example.workstar');
    const attribute = /data-workstar-[a-f0-9]{10}/.exec(code)?.[0];
    expect(attribute).toBeDefined();
    expect(css).toContain(
      `.card:where([${attribute}]) > .intro:hover:where([${attribute}])`,
    );
    expect(css).toContain(`.intro:where([${attribute}])::before`);
    expect(css).not.toContain('<style>');
    const content = evaluate(source)({});
    const host = document.createElement('div');
    host.innerHTML = renderToString(content);
    expect(host.querySelectorAll(`[${attribute}]`)).toHaveLength(2);
    expect(() => hydrate(host, content)).not.toThrow();
  });

  it('allows explicit global CSS and rejects misplaced or unsafe style blocks', () => {
    expect(
      compileComponentParts(
        '<p>Hello</p><style global>body { margin: 0 }</style>',
      ).css,
    ).toContain('body { margin: 0 }');
    expect(() =>
      compileComponent('<style>.x { color: red }</style><p>X</p>'),
    ).toThrow('A single <style> block must come last.');
    expect(() =>
      compileComponent(
        '<p>X</p><style>@import url(https://example.com/x.css);</style>',
      ),
    ).toThrow('@import belongs in a global stylesheet');
  });

  it('allows a static view without an empty script block', () => {
    const source = '<main><h1>Welcome</h1></main>';
    expect(compileComponent(source)).toContain(
      'export type Props = Record<string, never>;',
    );
    expect(renderToString(evaluate(source)({}))).toContain('<h1>Welcome</h1>');
    expect(() =>
      compileComponent(
        '<p>Before</p><script lang="ts">export interface Props {}</script>',
      ),
    ).toThrow('A <script lang="ts"> block must come first.');
  });

  it('keeps static no-script copy and rejects content that cannot hydrate', () => {
    const content = evaluate('<noscript>Use the email link above.</noscript>')(
      {},
    );
    const html = renderToString(content);
    expect(html).toContain('Use the email link above.');
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(() => hydrate(host, content)).not.toThrow();
    expect(() =>
      compileComponent('<noscript><p>Email us</p></noscript>'),
    ).toThrow('<noscript> supports static text only');
    expect(() =>
      compileComponent(`<script lang="ts">
export interface Props { notice: string }
</script><noscript>{notice}</noscript>`),
    ).toThrow('<noscript> supports static text only');
  });

  it('infers empty props for a component with local state', () => {
    const source = `<script lang="ts">
import { signal } from 'workstar';
const count = signal(0);
function increment() { count.value += 1; }
</script><button type="button" on:click={increment}>{count.value}</button>`;
    const code = compileComponent(source);
    expect(code).toContain('type Props = Record<string, never>;');
    const content = evaluate(source)({});
    const host = document.createElement('div');
    host.innerHTML = renderToString(content);
    const dispose = hydrate(host, content);
    expect(host.querySelector('button')?.textContent).toBe('0');
    dispose();
  });

  it('composes typed sibling views with camelCase props and preserves hydration', async () => {
    const renderChild = evaluate(`<script lang="ts">
import type { Readable } from 'workstar';
export interface Props { count: Readable<number>; projectUrl: string }
</script><a href={projectUrl}>Count {count.value}</a>`);
    const parentSource = `<script lang="ts">
import CounterLink from './counter-link.workstar';
import type { Readable } from 'workstar';
export interface Props { count: Readable<number>; projectUrl: string }
</script><div><Use component={CounterLink} count={count} projectUrl={projectUrl} /><p>After</p></div>`;
    expect(compileComponent(parentSource)).toContain(
      "import { render as CounterLink } from './counter-link';",
    );
    const renderParent = evaluate(parentSource, {
      './counter-link': { render: renderChild },
    });
    const count = signal(0);
    const content = renderParent({ count, projectUrl: '/project' });
    const host = document.createElement('div');
    host.innerHTML = renderToString(content);
    const link = host.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/project');
    expect(link?.textContent).toBe('Count 0');
    expect(host.querySelector('p')?.textContent).toBe('After');
    const dispose = hydrate(host, content);
    count.value = 1;
    await tick();
    expect(host.querySelector('a')).toBe(link);
    expect(link?.textContent).toBe('Count 1');
    dispose();
  });

  it('creates independent reactive state for each component instance', async () => {
    const render = evaluate(`<script lang="ts">
import { signal } from 'workstar';
export interface Props { label: string }
const count = signal(0);
function increment() { count.update((current) => current + 1); }
</script><button type="button" on:click={increment}>{label}: {count.value}</button>`);
    const first = render({ label: 'First' });
    const second = render({ label: 'Second' });
    const firstHost = document.createElement('div');
    const secondHost = document.createElement('div');
    firstHost.innerHTML = renderToString(first);
    secondHost.innerHTML = renderToString(second);
    const disposeFirst = hydrate(firstHost, first);
    const disposeSecond = hydrate(secondHost, second);
    const firstButton = firstHost.querySelector('button');
    const secondButton = secondHost.querySelector('button');
    expect(firstButton?.textContent).toBe('First: 0');
    expect(secondButton?.textContent).toBe('Second: 0');
    firstButton?.click();
    await tick();
    expect(firstButton?.textContent).toBe('First: 1');
    expect(secondButton?.textContent).toBe('Second: 0');
    expect(firstHost.querySelector('button')).toBe(firstButton);
    disposeFirst();
    disposeSecond();
  });

  it('rejects ambiguous or unsupported component syntax', () => {
    const props = '<script lang="ts">export interface Props {}</script>';
    expect(() =>
      compileComponent(
        `${props}<Use component={Child} children={content}><p>Slot</p></Use>`,
      ),
    ).toThrow('<Use> cannot set children twice.');
    expect(() => compileComponent(`${props}<Use></Use>`)).toThrow(
      '<Use> needs component={ImportedView}.',
    );
    expect(() =>
      compileComponent(
        '<script lang="ts">import Child from "child.workstar"; export interface Props {}</script><Use component={Child}></Use>',
      ),
    ).toThrow('Import a relative .workstar view with a default import.');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}; export const value = 1;</script><p>{value}</p>',
      ),
    ).toThrow('Component-local declarations cannot be exported.');
  });

  it('resolves component imports across nested view directories', () => {
    const source = `<script lang="ts">
import Card from './components/card.workstar';
import Footer from '../shared/footer.workstar';
export interface Props {}
</script><Use component={Card} /><Use component={Footer} />`;
    const generated = compileComponent(source);
    expect(generated).toContain(
      "import { render as Card } from './components/card';",
    );
    expect(generated).toContain(
      "import { render as Footer } from '../shared/footer';",
    );
    const viteModule = compileComponent(source, 'Page.workstar', {
      componentImports: 'source',
    });
    expect(viteModule).toContain(
      "import { render as Card } from './components/card.workstar';",
    );
    expect(viteModule).toContain(
      "import { render as Footer } from '../shared/footer.workstar';",
    );
  });

  it('composes a typed default slot with reactive content and preserves hydration', async () => {
    const renderChild = evaluate(`<script lang="ts">
import type { Template } from 'workstar';
export interface Props { title: string; children: Template }
</script><article><h2>{title}</h2>{children}</article>`);
    const renderParent = evaluate(
      `<script lang="ts">
import Card from './card.workstar';
import type { Readable } from 'workstar';
export interface Props { count: Readable<number> }
</script><Use component={Card} title="Counter"><p>Count {count.value}</p></Use>`,
      {
        './card': { render: renderChild },
      },
    );
    const count = signal(1);
    const content = renderParent({ count });
    const host = document.createElement('div');
    host.innerHTML = renderToString(content);
    const paragraph = host.querySelector('p');
    expect(host.querySelector('h2')?.textContent).toBe('Counter');
    expect(paragraph?.textContent).toBe('Count 1');
    const dispose = hydrate(host, content);
    count.value = 2;
    await tick();
    expect(host.querySelector('p')).toBe(paragraph);
    expect(paragraph?.textContent).toBe('Count 2');
    dispose();
  });

  it('compiles typed props, escaped text, safe attributes and lists', () => {
    const render = evaluate(`<script lang="ts">
export interface Props {
  title: string;
  href: string;
  facts: Array<{ value: string; label: string }>;
}
</script>
<section class="campaign-hero">
  <h1>{title}</h1>
  <a href={href}>Read more</a>
  <dl><Each each={facts} as="fact" key="value"><div><dt>{fact.value}</dt><dd>{fact.label}</dd></div></Each></dl>
</section>`);
    const output = renderToString(
      render({
        title: '<Audit>',
        href: '/contact?x=1&y=2',
        facts: [{ value: '2–4 days', label: 'Typical turnaround' }],
      }),
    );
    expect(output).toContain('&lt;Audit&gt;');
    expect(output).toContain('href="/contact?x=1&amp;y=2"');
    expect(output).toContain('<dt><!--workstar-slot-0-->2–4 days');
    expect(output).not.toContain('<each');
  });

  it('supports literal tuple indexes in component and list bindings', () => {
    const render = evaluate(`<script lang="ts">
export interface Props { labels: [string, string]; rows: Array<{ id: string; labels: [string, string] }> }
</script>
<p>{labels[0]}</p><ul><Each each={rows} as="row" key="id"><li>{row.labels[1]}</li></Each></ul>`);
    const output = renderToString(
      render({
        labels: ['People', 'Rules'],
        rows: [{ id: 'row', labels: ['A', 'B'] }],
      }),
    );
    expect(output).toContain('People');
    expect(output).toContain('B');
  });

  it('rejects unsafe URLs at the rendering boundary', () => {
    const render = evaluate(
      `<script lang="ts">export type Props = { href: string };</script><a href={href}>link</a>`,
    );
    expect(() =>
      renderToString(render({ href: 'javascript:alert(1)' })),
    ).toThrow('Unsafe URL');
    const staticRender = evaluate(
      '<script lang="ts">export interface Props {}</script><a href="javascript:alert(1)">link</a>',
    );
    expect(() => renderToString(staticRender({}))).toThrow('Unsafe URL');
  });

  it('hydrates the generated markup without replacing server DOM', () => {
    const render =
      evaluate(`<script lang="ts">export interface Props { title: string; rows: Array<{ value: string }> }</script>
<section><h1>{title}</h1><Each each={rows} as="row" key="value"><p>{row.value}</p></Each></section>`);
    const content = render({
      title: 'Audit',
      rows: [{ value: 'One' }, { value: 'Two' }],
    });
    const host = document.createElement('div');
    host.innerHTML = renderToString(content);
    const heading = host.querySelector('h1');
    const paragraphs = [...host.querySelectorAll('p')];
    const dispose = hydrate(host, content);
    expect(host.querySelector('h1')).toBe(heading);
    expect([...host.querySelectorAll('p')]).toEqual(paragraphs);
    dispose();
  });

  it('updates keyed compiled lists while preserving row identity', async () => {
    const render = evaluate(`<script lang="ts">
import type { Readable } from 'workstar';
export interface Props { rows: Readable<Array<{ id: string; label: string }>> }
</script>
<ul><Each each={rows} as="row" key="id"><li><span>{row.label}</span><input></li></Each></ul>`);
    const rows = signal([
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
    ]);
    const content = render({ rows });
    const host = document.createElement('div');
    host.innerHTML = renderToString(content);
    const original = host.querySelectorAll('li')[1]!;
    const input = original.querySelector('input')!;
    const dispose = hydrate(host, content);
    input.value = 'draft';
    rows.value = [
      { id: 'b', label: 'Beta updated' },
      { id: 'a', label: 'Alpha' },
    ];
    await tick();
    expect(host.querySelectorAll('li')[0]).toBe(original);
    expect(
      host.querySelectorAll('li')[0]?.querySelector('span')?.textContent,
    ).toBe('Beta updated');
    expect(input.value).toBe('draft');
    dispose();
  });

  it('renders and updates conditional blocks with an alternate branch', async () => {
    const render = evaluate(`<script lang="ts">
import type { Readable } from 'workstar';
export interface Props { visible: Readable<boolean>; title: string }
</script>
<section><If when={visible.value}><h2>{title}</h2><Else><p>Hidden</p></Else></If></section>`);
    const visible = signal(true);
    const content = render({ visible, title: 'Visible' });
    const host = document.createElement('div');
    host.innerHTML = renderToString(content);
    const heading = host.querySelector('h2');
    const dispose = hydrate(host, content);
    expect(host.querySelector('h2')).toBe(heading);
    visible.value = false;
    await tick();
    expect(host.querySelector('h2')).toBeNull();
    expect(host.querySelector('p')?.textContent).toBe('Hidden');
    visible.value = true;
    await tick();
    expect(host.querySelector('h2')?.textContent).toBe('Visible');
    dispose();
  });

  it('renders and hydrates controls inside select and table parsing contexts', async () => {
    const render = evaluate(`<script lang="ts">
import type { Readable } from 'workstar';
export interface Props { rows: Readable<Array<{ id: string; label: string }>>; showExtra: Readable<boolean> }
</script>
<select><Each each={rows} as="row" key="id"><option value={row.id}>{row.label}</option></Each><If when={showExtra.value}><option value="extra">Extra</option></If></select>
<table><tbody><Each each={rows} as="row" key="id"><tr><td>{row.label}</td></tr></Each></tbody></table>`);
    const rows = signal([{ id: 'a', label: 'Alpha' }]);
    const showExtra = signal(true);
    const content = render({ rows, showExtra });
    const markup = renderToString(content);
    expect(markup).toContain('<option value="a"');
    expect(markup).toContain('Alpha');
    expect(markup).toContain('<option value="extra">');
    expect(markup).toContain('<tr><td>');
    expect(markup).not.toContain('<template');
    const host = document.createElement('div');
    host.innerHTML = markup;
    const option = host.querySelector('option');
    const dispose = hydrate(host, content);
    rows.value = [{ id: 'a', label: 'Updated' }];
    showExtra.value = false;
    await tick();
    expect(host.querySelector('option')).toBe(option);
    expect(option?.textContent).toBe('Updated');
    expect(host.querySelectorAll('option')).toHaveLength(1);
    expect(host.querySelector('td')?.textContent).toBe('Updated');
    dispose();
  });

  it('leaves quoted attributes, comments, and textarea text untouched', () => {
    const render = evaluate(`<script lang="ts">
// <Each> here is not markup.
export interface Props {}
</script>
<!-- <If> here is a comment. -->
<p title="<Use> is text">Safe</p><textarea><Use> is text</textarea>`);
    const markup = renderToString(render({}));
    expect(markup).toContain('title="&lt;Use&gt; is text"');
    expect(markup).toContain('<textarea>&lt;Use&gt; is text</textarea>');
  });

  it('keeps native forms usable and attaches events only during hydration', () => {
    let clicks = 0;
    const render =
      evaluate(`<script lang="ts">export interface Props { action: string; label: string; handle: () => void }</script>
<form method="post" action={action}><label>Email <input type="email" name="email"></label><button type="submit" on:click={handle}>{label}</button></form>`);
    const content = render({
      action: '/contact',
      label: 'Send',
      handle: () => clicks++,
    });
    const serverMarkup = renderToString(content);
    expect(serverMarkup).toContain('method="post"');
    expect(serverMarkup).toContain('action="/contact"');
    expect(serverMarkup).not.toContain('onclick=');
    const host = document.createElement('div');
    host.innerHTML = serverMarkup;
    const button = host.querySelector('button');
    const dispose = hydrate(host, content);
    expect(host.querySelector('button')).toBe(button);
    button?.click();
    expect(clicks).toBe(1);
    dispose();
  });

  it('renders safe textarea values and keeps user edits during hydration', async () => {
    const render = evaluate(`<script lang="ts">
import type { Readable } from 'workstar';
export interface Props { value: Readable<string> }
</script>
<form><textarea name="challenge">{value.value}</textarea></form>`);
    const value = signal('A <draft> & details');
    const content = render({ value });
    const markup = renderToString(content);
    expect(markup).toContain('A &lt;draft&gt; &amp; details');
    expect(markup).not.toContain('<draft>');
    const host = document.createElement('div');
    host.innerHTML = markup;
    const textarea = host.querySelector('textarea')!;
    expect(textarea.value).toBe('A <draft> & details');
    textarea.value = 'User-edited before hydration';
    const dispose = hydrate(host, content);
    expect(host.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('User-edited before hydration');
    value.value = 'Updated from state';
    await tick();
    expect(textarea.value).toBe('Updated from state');
    dispose();
  });

  it('rejects unsupported syntax instead of silently producing wrong markup', () => {
    expect(() =>
      compileComponent('<h1>First</h1><script lang="ts"></script>'),
    ).toThrow('must come first');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}</script><p>{x + y}</p>',
      ),
    ).toThrow('Unsupported expression');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}</script><img onclick="alert(1)">',
      ),
    ).toThrow('Use on:event');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}</script><iframe srcdoc="unsafe"></iframe>',
      ),
    ).toThrow('srcdoc');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}</script><Each each={rows} as="row"><li>{row.name}</li></Each>',
      ),
    ).toThrow('needs each');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}</script><Else>bad</Else>',
      ),
    ).toThrow('inside <If>');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props { ok: boolean }</script><If when={ok}><Else>no</Else><p>late</p></If>',
      ),
    ).toThrow('last child');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props { value: string }</script><textarea>{value} extra</textarea>',
      ),
    ).toThrow('one {path}');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}</script><Each each={rows} as="row" key="self" />',
      ),
    ).toThrow('cannot be self-closing');
    expect(() =>
      compileComponent(
        '<script lang="ts">export interface Props {}</script><If when={ok}><p>x</p></Each>',
      ),
    ).toThrow('Mismatched');
  });
});
