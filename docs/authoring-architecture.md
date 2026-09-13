# Component authoring decision

## Problem

The `html` tag is a useful low-level rendering primitive, but it is not a suitable
default authoring format for full pages. Nested `map()` calls obscure the markup,
`attr()` turns ordinary HTML attributes into ceremony, and page files accumulate
layout, control flow, and content wiring in one function. Formatting the file does
not fix that problem.

The low-level `html` API still parses markup for each template instance and
replaces ordinary dynamic regions when their value changes. `repeat()` gives
lists keyed identity, but does not by itself cache static templates or reconcile
conditional branches. The `.workstar` compiler is the default authoring path for
the production Workstar Lab site; these runtime optimization opportunities remain
separate from the completed authoring migration.

## Direction

Build a separate, build-time component compiler. Keep the signal/runtime package
small and the server/app/router packages independent. A component should read as
markup with a small TypeScript script, not as a function assembling markup strings.
The compiler must lower both server and browser output from one validated component
representation; it must never evaluate template expressions from strings in the
browser.

Initial component capabilities:

- Type-checked props, component composition, and slots/children.
- Escaped text, validated attributes and URLs, and explicit event bindings.
- Declarative conditionals and keyed iteration, including empty states.
- Fine-grained updates that preserve unaffected DOM nodes and input state.
- Static markup hoisted or cached so it is not reparsed on every update.
- SSR HTML as the default; client code emitted only for explicit interaction.
- Scoped styles and useful source-location errors.

Syntax and file extension are not final. Decide them with a vertical slice that
renders a real Workstar Lab page, not by implementing every possible directive
upfront. Low-level `html` remains an escape hatch, not the recommended way to write
pages. Runtime-generated JSX templates are rejected as the default because they
create new markup descriptions during rendering and do not enable static analysis.

The compiler lives in `packages/compiler`. The Workstar Lab site authors its page
and shell components this way. The Vite plugin compiles imported
`.workstar` files in memory during development and build, without writing to
`src`. The CLI also accepts one file, `--all`, or `--watch`; its output mirrors
nested authored directories in a separate, ignored directory. No folder name
such as `views` is required. The compiler supports typed props, relative component imports and `<Use>`,
escaped path expressions, attributes, keyed `<Each>` blocks, and `<If>`/`<Else>`
branches, including inside `<select>` and table sections. Keys are mandatory,
unique strings or finite numbers; `key="self"` covers
unique primitive values. Nested `<Use>` content is passed as a typed `children: Template`
prop; named slots are not implemented. `<script lang="ts">` accepts imports,
an optional exported `Props` declaration, and per-instance local variables and
functions. A component without props infers an empty contract. A final `<style>`
block is scoped by default; `<style global>` is explicit. Expressions remain
deliberately narrow. Form actions belong to `workstar-app` or the application,
not to the component language.

Rust is a possible backend for the compiler, not a prerequisite for the component
contract. Keep the parser/code-generation boundary explicit and measure compile
time on representative projects before adding native binary distribution. Browser
runtime performance must be evaluated separately from compiler throughput.

## Cutover evidence and ongoing limits

1. The Workstar Lab site is deployed on Workstar. Its
   [browser and route checks](https://github.com/wslab-ai/workstarlab/tree/main/tests)
   cover server-rendered content, locales, metadata, accessibility, responsive
   layouts, contact delivery boundaries, and uploads. Recheck these on every
   application release; a passing framework starter is not a site parity test.
2. Framework verification covers SSR/hydration, keyed lists, escaping, browser
   interactions, and both starters. The Worker starter demonstrates a standard
   no-JavaScript form action; the production site's Turnstile-protected contact
   form instead provides an email link when JavaScript is unavailable.
3. The compiler writes generated files outside authored `src` directories. The
   Vite plugin transforms imports in memory; `dev`, `check`, and `build` must not
   require developers to run code generation manually.
4. Cold render, update, hydration, client JavaScript, and build output should be
   measured on repeatable workloads before claiming a speed advantage over other
   frameworks. The current gzip budget is a size gate, not such a comparison.

## References

- Svelte components and keyed each blocks:
  https://svelte.dev/docs/svelte/svelte-files
  https://svelte.dev/docs/svelte/each
- Vue on templates, compiler optimizations, and keyed identity:
  https://vuejs.org/guide/extras/rendering-mechanism.html
  https://vuejs.org/guide/essentials/list.html
- Solid on compiled JSX and fine-grained updates:
  https://docs.solidjs.com/concepts/understanding-jsx
  https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity
- Lit on template identity and keyed lists:
  https://lit.dev/docs/templates/overview/
  https://lit.dev/docs/templates/lists/
- Astro on server-first islands:
  https://docs.astro.build/en/concepts/islands/
