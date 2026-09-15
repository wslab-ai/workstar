# Experimental TSX and Vue source compatibility

Workstar can compile a limited set of React-style `.tsx` and Vue `.vue` source components to its own template runtime. The generated module imports `workstar`, not React or Vue. This is source compatibility, not an implementation of either framework's full component API. Unsupported syntax fails compilation instead of silently changing behavior.

## Supported source

- TSX: one exported function (default or named) returning intrinsic JSX markup or supported local TSX components; relative imports of those components, including extensionless imports; typed, destructured props with optional literal defaults; type-only `HTMLAttributes` imports from React for inherited props; native-element rest spreads with checked scalar HTML attributes; text and attribute path expressions, plus stateless template/string expressions such as computed class names; static attributes; selected native event bindings such as `onClick`, `onInput`, and `onKeyDown`. `onDoubleClick` maps to `dblclick`; React-specific `onChange` and capture handlers are rejected on native elements. `className` and `htmlFor` map to HTML attributes on native elements and remain props on child components.
- Vue SFC: one `<template>`, optional `<script setup lang="ts">defineProps<{...}>()</script>` (also `const props = defineProps<{...}>()`), and one optional plain or `scoped` `<style>` block. Simple `{{ path }}` text interpolations, `:attribute="path"` bindings, and native `@event="handler"` bindings become Workstar expressions. Primitive `ref()` state becomes a Workstar signal; a `reactive({ count: 0 })` record with primitive fields becomes a shallow Workstar store. Both need their named `vue` import in source, which the compiler removes. Parameterless event handlers may write known state fields. Vue class/style normalization is not emulated, so dynamic `:class` and `:style` are rejected.

In the source-compilation mode described above, React hooks, Context, refs, class components, component-prop spreads, complex JSX expressions, non-TSX module imports, Vue control directives (`v-if`, `v-for`, `v-model`), Vue deep reactivity and other Composition APIs, slots, plugins, and third-party component libraries are not supported. Native-element rest spreads reject event handlers, styles, refs, `children`, and unsafe URLs at runtime. The recognized source-only `ref` and `reactive` imports are removed during compilation; type-only React imports are erased by TypeScript and need React type declarations only during type checking. Packages that import `react`, `react-dom`, or `vue` at runtime cannot be made runtime-free by this compiler.

Event handlers receive native DOM events, not React synthetic events or Vue component emits. Review handlers that depend on framework-specific event behavior before converting them.

## Vite

Add `workstar()` from `workstar-compiler/vite` to the Vite 7 or 8 plugins. Opt in per import using `?workstar`:

```workstar
<script lang="ts">
  import LegacyButton from './LegacyButton.tsx?workstar';
  import { Loader } from './Loader.tsx?workstar';
  import StatusBadge from './StatusBadge.vue?workstar';

  function save() { /* application action */ }
</script>

<Use component={LegacyButton} label="Save" onClick={save} />
<Use component={Loader} label="Loading" />
<Use component={StatusBadge} label="Ready" />
```

The plugin transforms those imports before other TSX/Vue plugins and extracts supported Vue styles as CSS. It does not require the React or Vue runtime. Ambient TypeScript declarations for `*?workstar` imports are needed until generated per-file declarations are available; use the CLI path below when strict prop contracts matter.

Supported TSX components may import each other through local relative imports such as `import { Loader } from './Loader'`. The Vite plugin resolves those imports to opt-in Workstar modules. Every imported component in that tree must also satisfy the supported source subset.

For a source tree that should use ordinary imports without editing each file, configure `workstar({ foreign: 'automatic' })`. The plugin then compiles `.tsx` and `.vue` files under `src` as Workstar modules. It also recognizes a conventional TSX entry that imports `createRoot` from `react-dom/client`, optionally wraps one local component in `StrictMode`, and calls `createRoot(root).render(...)`; that entry mounts the compiled component through Workstar. This mode is still limited to the supported source subset and fails on unsupported files. It does not yet run a full React application with hooks, Context, or React Router. Keep the existing application source unchanged while using a separate build configuration for migration experiments.

## Runtime compatibility for an unchanged React application

For applications that use React state and routing, `workstar({ foreign: 'runtime' })` keeps the original TSX and redirects React imports and automatic JSX output to a separate Workstar compatibility runtime. Replace the React Vite plugin with this plugin in the migration build configuration. The source files do not need import changes:

```ts
import { workstar } from 'workstar-compiler/vite';

export default {
  plugins: [workstar({ foreign: 'runtime' })],
};
```

This runtime currently implements `createRoot`, `hydrateRoot`, JSX, `Component`, `createElement`, `createRef`, `Children`, `cloneElement`, `isValidElement`, `memo`, `useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useMemo`, `useCallback`, `useRef`, `useImperativeHandle`, `useId`, `useSyncExternalStore`, `createContext`/`useContext`, `forwardRef`, `lazy`/`Suspense`, `createPortal`, `flushSync`, and a limited React Router surface (`BrowserRouter`, `Routes`, `Route`, `Navigate`, `Outlet`, `Link`, `NavLink`, and their location/parameter/navigation hooks). It uses Workstar signals and DOM templates. Layout effects run after DOM bindings commit and before deferred passive effects. `memo` uses shallow prop equality by default and accepts a custom comparator. Class components support state, lifecycle methods, and render error boundaries. The esbuild compatibility check rejects bundled React, React DOM, React Router, or Vue runtime modules.

For migration builds whose source files live outside the Vite project, set `runtimeImportSource` to the absolute directory containing Workstar's compatibility runtime, for example the directory of `import.meta.resolve('workstar/compat/react')`. This gives external source files one runtime instance. Next.js App Router imports need host-specific adapters for `next/navigation`, `next/link`, and `next/image`; Workstar does not execute Next.js server components, route loaders, or package internals.

Run `npm run verify:compat:runtime-vite` to build a small React-style TSX application through the Workstar Vite runtime mode and exercise state, context, nested routing, and retention of form fields and keyed rows in Chromium, Firefox, and WebKit. The check also rejects bundled React or Vue runtime modules.

The same runtime modules can be used with another TSX bundler by mapping `react` to `workstar/compat/react`, `react-dom/client` to `workstar/compat/react/client`, `react-dom` to `workstar/compat/react/dom`, `react-dom/server` to `workstar/compat/react/server`, and `react-router` or `react-router-dom` to `workstar/compat/react-router`, then setting the automatic JSX import source to `workstar/compat/react`. This alias and JSX configuration is bundler-specific, while the runtime itself has no Vite dependency. `npm run verify:compat:esbuild` builds an unchanged React-style TSX entry with esbuild and verifies that no React/Vue runtime modules enter its bundle.

TSX trees can render on the server and hydrate through the same compatibility layer:

```ts
import { renderToString } from 'workstar/compat/react/server';
import { hydrateRoot } from 'workstar/compat/react/client';

const markup = renderToString(<App />);
hydrateRoot(document.querySelector('#app')!, <App />);
```

`renderToString` emits Workstar hydration markers. `renderToStaticMarkup` removes them for HTML that will remain static. Server rendering uses `getServerSnapshot` from `useSyncExternalStore`, skips effects and class mount/update lifecycle methods, renders a synchronous Suspense fallback, and rejects portals because they require a browser container. Streaming Suspense is not implemented.

This is experimental compatibility, not complete React semantics. State updates rerun affected component functions and retain stable intrinsic DOM nodes, including keyed list rows and unchanged form fields. Local updates prune unchanged component branches; keyed memoized lists update only affected item trees. Changing element structure or supported prop bindings can still replace nodes, and transition continuity is not yet equivalent to React. Controlled text inputs preserve a valid focused selection when their value changes. Events are native DOM events rather than SyntheticEvents. Portals mount a Workstar-managed host within the target container. Only a restricted SVG data image is accepted for an `<img>` source. General third-party React libraries still need browser verification.

## Any other bundler or server

The compatibility compiler is independent of Vite. Compile a supported source file to a typed Workstar module:

```sh
workstar-compile --compat src/LegacyButton.tsx .workstar/generated/LegacyButton.ts
workstar-compile --compat src/StatusBadge.vue .workstar/generated/StatusBadge.ts --css public/status-badge.css
```

Import the generated `render` function from your application. Include the emitted CSS in the page for Vue styles. The module can render on a server with `workstar/server` or mount in a browser with `workstar`; the host's normal TypeScript build handles the generated module. The `workstar-compiler/compat` export also provides `convertReactComponent` and `convertVueComponent` for build-tool integrations.

For a local TSX component tree, compile every imported source into the same relative layout under the generated directory. The CLI rewrites local component imports to those generated modules. For example, `src/Parent.tsx` importing `src/ui/Child.tsx` needs generated files at `generated/Parent.ts` and `generated/ui/Child.ts`.

For now the CLI compiles files individually. Pass only components within the supported subset, and run the application's normal type check and production build after compilation.

To assess a larger codebase before changing it, run `workstar-compile --compat-audit src`. It prints a JSON report with each production `.tsx` and `.vue` file, its detected component name, whether it currently converts, the first unsupported construct, a migration suggestion, and imported package inventory. Dependencies handled by Workstar aliases are distinguished from packages that require browser verification. Files named `*.test`, `*.spec`, or `*.stories` are excluded. The audit reads sources without emitting files; a successful audit result still needs the normal type check, build, and browser verification. Runtime-mode Vite builds also reject unsupported named or namespace React API use with the source file, line, column, missing export, and implemented alternatives.
