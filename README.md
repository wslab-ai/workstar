# Workstar

Workstar is a TypeScript UI framework for small applications. It combines explicit reactive state with declarative HTML templates and updates only the affected DOM regions. The runtime has no dependencies or virtual DOM. An optional `.workstar` compiler provides component-local markup, state, and scoped CSS.

Workstar is developed independently. Its reactive core, component compiler, optional routing, and HTTP application layer are separate packages, so projects can adopt only the parts they need.

## Start a project

```sh
npx workstar@0.1.0 create my-app
cd my-app
npm install
npm run dev
```

The starter uses `.workstar` components as its default authoring format. Its example
counter keeps reactive state and the click handler inside the component. Edit
`src/views/app.workstar` or place components in any other `src` subdirectory;
`views` is not reserved. Vite compiles imported components in memory. Run
`npm run check` to validate their TypeScript contracts using an ignored
`.workstar/` cache outside `src`. `npm run build` produces a static `dist/` directory, ready for
any static host. There is no mandatory vendor account or server runtime.

For a server-rendered Cloudflare Worker with static assets and standard HTML form actions:

```sh
npx workstar@0.1.0 create my-worker --template worker
cd my-worker
npm install
npm run check
npm run dev
```

The Worker template is also an example, not a production contact service: its form validates input and redirects, but does not send email.

For VS Code, the [Workstar language extension](editors/vscode/README.md) provides
`.workstar` syntax highlighting, embedded TypeScript/CSS scopes, editing pairs,
and snippets. It can currently be installed from a locally built VSIX.

## Low-level core API

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
Dynamic expressions inside `<script>`, `<style>`, `<textarea>`, `<title>`, and `<noscript>` are deliberately rejected because browser HTML parsing does not preserve hydration markers there. Keep metadata and script data in the server document layer; use native form controls and attributes for editable values.

For multi-page apps, [`workstar-router`](packages/router/README.md) is an optional, separately versioned URL matcher. The core does not import it. It shares route matching and link generation between server and browser; native links work without JavaScript. [`workstar-app`](packages/app/README.md) is a separate Fetch-native layer for SSR documents, GET/HEAD pages, POST actions, and typed metadata. It works on Cloudflare Workers without adding Worker dependencies to the core.

For low-level composition, ordinary functions can return `html` templates. Interpolate a function to make a conditional or calculated region reactive:

```ts
const visible = signal(true);
const Message = (name: string) => html`<p>Hello, ${name}.</p>`;

html`<section>${() => (visible.value ? Message('world') : null)}</section>`;
```

Nested reactive subscriptions and listeners are cleaned up when their region disappears. Primitive text updates reuse the same text node. Dynamic URL attributes reject non-HTTP(S), `mailto:`, or `tel:` schemes.

## Scope and limits

The 0.1 release provides reactive DOM updates, server rendering and hydration, a component compiler, optional URL matching and Fetch-native request handling, and static and server-rendered starters. Native links remain the default; client-side navigation, automatic data loading, authentication, upload storage, and deployment configuration are application responsibilities. The component compiler intentionally accepts a documented subset of component syntax. The Worker starter demonstrates a no-JavaScript form action but does not send email.

Run `npm run verify` for formatting, types, tests, build, a gzip size budget, Worker type checks, and pack checks. Run `npm run verify:hydration` for a real-browser SSR/hydration test, and `npm run verify:starter` to create and browser-test the Vite starter against the local package. The [architecture notes](docs/architecture.md) explain the boundaries and release gates. MIT licensed.
