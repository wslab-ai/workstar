# Workstar

Workstar is an **experimental** TypeScript UI framework for small browser applications. It combines explicit reactive state with declarative HTML templates and updates only the affected DOM regions. It has no runtime dependencies, virtual DOM, or component compiler.

Workstar is an original project inspired by the developer experience of Svelte and Vue; it is not a fork, wrapper, or drop-in replacement for either one. The existing [`@workstarlab/ui`](https://github.com/wslab-ai/ui) package remains a separate Svelte 5 design system.

## Start a project

After the `workstar` package is published to npm:

```sh
npx workstar create my-app
cd my-app
npm install
npm run dev
```

Until then, clone this repository and run `node bin/workstar.js create my-app`; the generated starter refers to the unpublished npm version, so install this repository as a local or Git dependency before running it.

The starter uses Vite. `npm run build` produces a static `dist/` directory, ready for any static host. There is no mandatory vendor account or server runtime.

## Core API

```ts
import { attr, computed, html, mount, on, signal } from 'workstar';

const count = signal(0);
const doubled = computed(() => count.value * 2);

const dispose = mount(
  document.querySelector('#app')!,
  html`<button
    type="button"
    ${on('click', () => count.update((current) => current + 1))}
    ${attr('aria-label', () => `Count ${count.value}`)}
  >
    Count: ${count}; doubled: ${doubled}
  </button>`,
);

// Call dispose() when the view is no longer needed.
```

`signal()` provides writable state. `computed()` derives a lazy read-only value. `effect()` runs on changes and returns a disposer. Synchronous writes are coalesced into one microtask; `await tick()` waits for DOM effects after a write. `html` interpolations insert strings as **text**, never as HTML. Use `attr(name, value)` for dynamic attributes and `on(event, handler)` for listeners, both inside an opening tag.

Components are ordinary functions returning `html` templates. Interpolate a function to make a conditional or calculated region reactive:

```ts
const visible = signal(true);
const Message = (name: string) => html`<p>Hello, ${name}.</p>`;

html`<section>${() => (visible.value ? Message('world') : null)}</section>`;
```

Nested reactive subscriptions and listeners are cleaned up when their region disappears. Primitive text updates reuse the same text node. Dynamic URL attributes reject non-HTTP(S), `mailto:`, or `tel:` schemes.

## Status and limits

This is `0.1.0-alpha`: suitable for experiments, **not** a production replacement for Vue, Svelte, or SvelteKit. It currently supports browser-side mounting only. It does not yet include SSR, hydration, routing, async components, form actions, devtools, or a compiler. The existing Workstar Lab site will stay on SvelteKit until those capabilities and accessibility/performance tests are mature. Do not put essential SEO content or no-JavaScript forms in a Workstar-only view yet.

Run `npm run verify` for formatting, types, tests, build, a gzip size budget, and pack checks. Run `npm run verify:starter` to create, build, and browser-test a starter against the local package. The [architecture notes](docs/architecture.md) explain the boundaries and release gates. MIT licensed.
