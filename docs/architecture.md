# Architecture

Workstar has four core concerns and two optional application packages, with a one-way dependency graph:

```text
CLI + starter       ─────► public package API
Worker starter      ─────► workstar-app + public package API
workstar-app        ─────► workstar/server + workstar-router
DOM hydration/mount ─────► shared template model + reactivity
server rendering    ─────► shared template model + attribute rules
React compatibility ─────► DOM/server rendering + shared reactivity
shared model        ─────► reactivity
reactivity          ─────► no browser or package dependency
workstar-router     ─────► no Workstar or DOM dependency
```

`src/reactivity.ts` owns signals, lazy derived values, effect dependency tracking, and a microtask scheduler. It has no DOM import. Dependencies are tracked only while an effect or computed value is evaluated. Effects have explicit disposers and computed values detach from sources when no one observes them.

`src/template-model.ts` defines the template and directive contract. `src/attribute-value.ts` is the single validation rule for dynamic attributes in both rendering environments. `src/template.ts` owns DOM ranges, event/attribute bindings, hydration, and view scopes. Static markup is parsed once per template instance; updates touch only dynamic ranges. Nested scopes dispose their listeners and effects when replaced. `mount()` owns a host and makes remount/dispose idempotent.

`src/server.ts` renders escaped HTML and deterministic slot markers without a DOM. `hydrate()` attaches to those markers, preserves the initial server DOM, rejects mismatched dynamic content, and then uses the same reactive bindings as `mount()`. The server module has no dependency on the DOM module. A Chromium proof checks that a server-rendered button keeps its identity while becoming interactive.

`src/compat/react` adapts React-shaped elements and hooks to those same contracts. Its client renderer schedules layout and passive effects in separate commit phases, prunes unaffected component and keyed-list branches, and keeps intrinsic nodes stable. Its server renderer emits the same markers consumed by `hydrateRoot`; it has no browser dependency for ordinary HTML elements.

`packages/compiler` is an optional build-time package. It compiles restricted
`.workstar` components into typed TypeScript modules. The Vite integration transforms
imports in memory; the CLI recursively compiles or watches arbitrary directories
and writes to a separate, ignored output directory. Its Node.js and parser
dependencies do not enter the browser runtime.
`bin/workstar.js` scaffolds `templates/basic` (Vite static app) or `templates/worker` (SSR Cloudflare Worker). Neither the CLI nor the runtime imports a starter. Cloudflare dependencies live only in the Worker template, not in the core or `workstar-app`.

`packages/router` is a separate package in the same repository. It owns shared URL matching and link generation, not DOM rendering or request handling. `packages/app` composes it with DOM-free SSR in a Fetch-native handler; it owns method dispatch, document metadata, status codes, and redirects, not platform bindings or application-specific form validation. Native page loads remain the default. Optional client transitions can be added later without coupling the reactive core to navigation.

## Influences and deliberate differences

- [Vue's reactive refs and computed values](https://vuejs.org/guide/extras/reactivity-in-depth.html) inform the state API; Workstar uses only shallow signals for now, not deep reactive proxies.
- [Svelte's compiled DOM updates](https://svelte.dev/) inform the goal; Workstar's compiler is an original, deliberately smaller component language.
- [Lit's tagged-template expressions](https://lit.dev/docs/templates/overview/) inform the HTML API; Workstar adds direct signal tracking and local cleanup scopes.

The runtime avoids a virtual DOM. The compiler is separate and currently lowers
components to the shared template runtime rather than emitting optimized DOM
instructions. Component composition and scoped styles are available; measured
build/runtime performance remains an optimization gate, not an established speed
claim.

## Acceptance gates

1. Strict TypeScript checks, deterministic unit tests, and a production starter build must pass.
2. The runtime must remain below 8 KiB gzip as a regression budget; this is a size constraint, not a speed claim.
3. Browser tests cover real interaction, keyboard focus, text safety, remounting, and cleanup. Keep those checks in the release gate.
4. The HTTP layer and Worker starter alone do not prove website parity. The deployed Workstar Lab site has separate route, locale, SEO, form, accessibility, and responsive browser checks; re-run them for site releases.
5. The Workstar Lab site must keep server-rendered content, metadata, locales, contact delivery and uploads, an accessible no-JavaScript contact path, and deployment working. Its Turnstile-protected form requires JavaScript; the no-JavaScript path is email, not a bypass around the challenge.

The initial 0.1 release is not a claim of parity with larger frameworks or their ecosystems. Benchmarking must use repeatable browser workloads rather than marketing statements.
