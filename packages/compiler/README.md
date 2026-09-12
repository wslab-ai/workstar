# Workstar compiler

The `.workstar` component compiler, command-line checker, and optional Vite plugin for Workstar applications.

Use the compiler with a matching Workstar version and validate a project with `npm run check` before building. A component can live in any directory under the configured source root; generated type-checking files belong outside authored `src`.

The `workstar-compile` command compiles one component or a directory:

```sh
workstar-compile --all src .workstar/generated --css .workstar/styles.css
```

For Vite, import `workstar` from `workstar-compiler/vite` and add `workstar()` to `plugins`. Vite compiles imported components in memory; the CLI is for explicit output and type checking.

Inside `<script lang="ts">`, imports and an optional exported `Props` type define the component contract. Top-level `const`, `let`, and function declarations create state and behavior for each component instance; import `signal` from `workstar` for reactive local state. Keep module-wide shared state in an imported TypeScript module when sharing is intentional.

`<noscript>` accepts static text only. Put links and localized expressions elsewhere in the page; nested markup would be parsed as raw text and dynamic markers cannot hydrate reliably.

See the [Workstar repository](https://github.com/wslab-ai/workstar) for starters and current limitations.
