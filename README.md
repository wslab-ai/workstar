# Workstar

Workstar is a TypeScript UI framework for web applications. It combines explicit reactive state with declarative HTML templates and updates only the affected DOM regions. The runtime has no dependencies or virtual DOM. An optional `.workstar` compiler provides component-local markup, state, and scoped CSS. Experimental React-style TSX compatibility lets existing components run without React at runtime; see the supported APIs and limits below.

Workstar is developed independently. Its reactive core, component compiler, optional routing, and HTTP application layer are separate packages, so projects can adopt only the parts they need.

The [Workstar wiki](https://github.com/wslab-ai/workstar/wiki) covers installation, component authoring, reactivity, rendering, routing, server actions, tooling, deployment, and migration.

## Start a project

```sh
npx workstar@0.2.2 create my-app
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
npx workstar@0.2.2 create my-worker --template worker
cd my-worker
npm install
npm run check
npm run dev
```

The Worker template is also an example, not a production contact service: its form validates input and redirects, but does not send email.

For a server-rendered Node.js application without a platform-specific runtime:

```sh
npx workstar@0.2.2 create my-node-app --template node
cd my-node-app
npm install
npm run dev
```

The Node starter uses the same Fetch-native application contract. Its example form
also validates and redirects without storing or sending data. Run `npm run build &&
npm start` for the compiled server.

For VS Code, the [Workstar language extension](editors/vscode/README.md) provides
`.workstar` syntax highlighting, embedded TypeScript/CSS scopes, compiler
diagnostics, import navigation, editing pairs, and snippets. Install
`wslab-ai.workstar-language` from the VS Code Extensions view.

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

`signal()` provides writable state. `computed()` derives a lazy read-only value. `effect()` runs on changes and returns a disposer. Synchronous writes are coalesced into one microtask; `await tick()` waits for DOM effects after a write. `html` interpolations insert strings as **text**, never as HTML. Use `attr(name, value)` for dynamic attributes, `attrs(record)` for a checked plain record of HTML attributes, and `on(event, handler)` for listeners, all inside an opening tag. Attribute records reject event handlers, styles, refs, and unsafe URLs.

For a small object with independent reactive fields, use `store({ count: 0, label: 'Ready' })` and update a field with `state.count++` or `state.label = 'Done'`. A store is shallow and accepts primitive fields only; nested objects and changing its keys are deliberately unsupported. An effect reading `state.count` does not rerun when only `state.label` changes.

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

## Experimental TSX and Vue source compatibility

Supported stateless TSX and Vue SFC components can be compiled to Workstar modules without React or Vue runtimes. Vite accepts explicit `?workstar` imports; `workstar-compile --compat` works with other bundlers and server builds. An experimental runtime mode also builds unchanged React TSX source with Workstar-backed hooks, class error boundaries, routing, SSR, and in-place hydration, without bundling React. See the [compatibility guide](docs/foreign-components.md) for syntax, verification, and limits.

## Scope and limits

The 0.2 release provides reactive DOM updates, server rendering and hydration, a component compiler, optional URL matching and Fetch-native request handling, and static and server-rendered starters. Native links remain the default; client-side navigation, automatic data loading, authentication, upload storage, and deployment configuration are application responsibilities. The component compiler intentionally accepts a documented subset of component syntax. The Worker starter demonstrates a no-JavaScript form action but does not send email.

Run `npm run verify` for formatting, types, tests, build, a gzip size budget, Worker type checks, and pack checks. Run `npm run bench` for repeatable local performance measurements. The [compatibility contract](docs/compatibility.md) states the supported runtimes and development-update limits; the [architecture notes](docs/architecture.md) explain the boundaries and release gates. MIT licensed.
