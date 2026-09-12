# Component authoring decision (draft)

## Problem

The `html` tag is a useful low-level rendering primitive, but it is not a suitable
default authoring format for full pages. Nested `map()` calls obscure the markup,
`attr()` turns ordinary HTML attributes into ceremony, and page files accumulate
layout, control flow, and content wiring in one function. Formatting the file does
not fix that problem.

The current implementation still reparses template markup while mounting and
replaces ordinary dynamic regions when their value changes. The new `repeat()`
primitive gives lists keyed identity, but it does not solve static-template caching
or conditional-region reconciliation. A nicer runtime wrapper around `html` would
hide these costs, not remove them. Do not migrate production pages or call the
framework stable until the authoring and update model below is implemented and measured.

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

The first vertical slice now lives in `packages/compiler`. The Workstar Lab preview
authors its page and shell views this way. The Vite plugin compiles imported
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
block is scoped by default; `<style global>` is explicit. This is **not** the final
component format: expressions are narrow, and there is no complete form/action integration. These are deliberate fail-closed limits while
the generated SSR and local build path are tested.

Rust is a possible backend for the compiler, not a prerequisite for the component
contract. Keep the parser/code-generation boundary explicit and measure compile
time on representative projects before adding native binary distribution. Browser
runtime performance must be evaluated separately from compiler throughput.

## Acceptance before website migration

1. One representative page and one interactive form use the new authoring format.
2. SSR output, hydration, keyed reordering, escaping, accessibility, no-JavaScript
   form submission, and 320–2560 px reflow have automated coverage.
3. A starter project can be created, built, tested, and deployed from a local
   checkout with documented commands and no unpublished registry dependency.
4. Compare cold render, update, hydration, client JavaScript, and build output
   against the existing Svelte site and the current Workstar preview. Set budgets
   from measurements; do not describe the framework as faster without evidence.
5. Keep the SvelteKit production site unchanged until route, locale, SEO, form,
   responsive, and accessibility parity are demonstrated.
6. Treat developer experience as a release gate: from a fresh scaffold, a developer
   can add a typed component and stylesheet, plus a page route and server form
   action in the Worker starter, by editing authored files only. `dev`, `check`,
   and `build` must work without manually running code generation; an invalid
   view must report its authored filename and recover after an edit. Keep import
   paths readable and generated files out of authored view directories and code
   review. Verify both starters and a representative Workstar Lab page before
   calling the workflow stable.

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
