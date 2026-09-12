# Workstar

Workstar is an **experimental** TypeScript UI framework for small applications. It combines explicit reactive state with declarative HTML templates and updates only the affected DOM regions. It has no runtime dependencies, virtual DOM, or component compiler.

Workstar is an original project inspired by the developer experience of Svelte and Vue; it is not a fork, wrapper, or drop-in replacement for either one. The existing [`@workstarlab/ui`](https://github.com/wslab-ai/ui) package remains a separate Svelte 5 design system.

## Start a project

The package is currently an alpha release on npm:

```sh
npx workstar@alpha create my-app
cd my-app
npm install
npm run dev
```

The starter uses Vite. `npm run build` produces a static `dist/` directory, ready for any static host. There is no mandatory vendor account or server runtime.

For a server-rendered Cloudflare Worker with static assets and standard HTML form actions:

```sh
npx workstar@alpha create my-worker --template worker
cd my-worker
npm install
npm run check
npm run dev
```

The Worker template is also an example, not a production contact service: its form validates input and redirects, but does not send email.

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

Server rendering is available as a low-level API. Build the same view with the same initial data on server and client:

```ts
import { renderToString } from 'workstar/server';
// On the server: <div id="app">${renderToString(view)}</div>

import { hydrate } from 'workstar';
// In the browser: hydrate(document.querySelector('#app')!, view);
```

`hydrate()` preserves the initial DOM and attaches reactive behavior to server markers. It throws if dynamic server content differs from the client view; treat such a mismatch as an application bug, not a signal to silently discard server HTML.
Dynamic expressions inside `<script>`, `<style>`, `<textarea>`, and `<title>` are deliberately rejected because browser HTML parsing does not preserve hydration markers there. Keep metadata and script data in the server document layer; use native form controls and attributes for editable values.

For multi-page apps, [`workstar-router`](packages/router/README.md) is an optional, separately versioned URL matcher. The core does not import it. It shares route matching and link generation between server and browser; native links work without JavaScript. [`workstar-app`](packages/app/README.md) is a separate Fetch-native layer for SSR documents, GET/HEAD pages, POST actions, and typed metadata. It works on Cloudflare Workers without adding Worker dependencies to the core.

Components are ordinary functions returning `html` templates. Interpolate a function to make a conditional or calculated region reactive:

```ts
const visible = signal(true);
const Message = (name: string) => html`<p>Hello, ${name}.</p>`;

html`<section>${() => (visible.value ? Message('world') : null)}</section>`;
```

Nested reactive subscriptions and listeners are cleaned up when their region disappears. Primitive text updates reuse the same text node. Dynamic URL attributes reject non-HTTP(S), `mailto:`, or `tel:` schemes.

## Status and limits

This is `0.1.0-alpha`: suitable for experiments, **not** a production replacement for Vue, Svelte, or SvelteKit. SSR, hydration, optional routing, a small HTTP app layer, and a Worker starter exist. Missing production gates include real-site route/content parity, contact delivery and uploads, locale SEO, accessible components, comprehensive browser tests, performance comparison, and a rollback plan. The existing Workstar Lab site stays on SvelteKit until those gates pass. The Worker starter can serve essential SEO content and no-JavaScript forms, but it does not implement the site's production contact flow.

Run `npm run verify` for formatting, types, tests, build, a gzip size budget, Worker type checks, and pack checks. Run `npm run verify:hydration` for a real-browser SSR/hydration test, and `npm run verify:starter` to create and browser-test the Vite starter against the local package. The [architecture notes](docs/architecture.md) explain the boundaries and release gates. MIT licensed.
