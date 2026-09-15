# Workstar compiler

The `.workstar` component compiler, command-line checker, and optional Vite plugin for Workstar applications.

Use the compiler with a matching Workstar version and validate a project with `npm run check` before building. A component can live in any directory under the configured source root; generated type-checking files belong outside authored `src`.

The `workstar-compile` command compiles one component or a directory:

```sh
workstar-compile --all src .workstar/generated --css .workstar/styles.css
```

For Vite, import `workstar` from `workstar-compiler/vite` and add `workstar()` to `plugins`. Vite compiles explicit `?workstar` component imports in memory. Use `workstar({ foreign: 'automatic' })` to compile ordinary TSX/Vue imports under `src`, including a supported `createRoot(...).render(...)` entry. Use `workstar({ foreign: 'runtime' })` for unchanged React TSX applications that need Workstar-backed state and routing. The runtime mode is experimental and does not yet reproduce every React behavior. The CLI is for explicit output and type checking.

During Vite development, the compiler adds state identities for direct local
`signal()` declarations. Pass a stable `HotContext` from `workstar/dev` to a
root component when accepting Vite updates, as shown in the static starter.
Production output does not include this instrumentation. The compiler maps
script statements and the markup entry point back to authored source in Vite;
individual markup expressions are not mapped yet.

Inside `<script lang="ts">`, imports and an optional exported `Props` type define the component contract. Top-level `const`, `let`, and function declarations create state and behavior for each component instance; import `signal` from `workstar` for reactive local state. Keep module-wide shared state in an imported TypeScript module when sharing is intentional.

Use `bind:attrs={record}` on a native element to spread a plain record of checked HTML attributes. The record can be reactive. Event handlers, styles, refs, and unsafe URLs are rejected; bind events explicitly with `on:event`.

Run `workstar-compile --compat-audit src` before migrating a TSX or Vue tree. The JSON report identifies the component and first unsupported construct in each file, suggests runtime mode when appropriate, and inventories packages handled by Workstar aliases or requiring browser verification. Runtime-mode Vite builds fail early on unsupported React API imports and include the source position and implemented alternatives.

`<noscript>` accepts static text only. Put links and localized expressions elsewhere in the page; nested markup would be parsed as raw text and dynamic markers cannot hydrate reliably.

See the [Workstar repository](https://github.com/wslab-ai/workstar) for starters and current limitations.

For experimental React-style TSX and Vue SFC source conversion without their runtimes, see the [compatibility guide](https://github.com/wslab-ai/workstar/blob/main/docs/foreign-components.md). Use `?workstar` imports with the Vite plugin or `workstar-compile --compat` with any other build system.
