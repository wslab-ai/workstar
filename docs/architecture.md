# Architecture

Workstar has four core concerns and two optional application packages, with a one-way dependency graph:

```text
CLI + starter       ─────► public package API
Worker starter      ─────► workstar-app + public package API
workstar-app        ─────► workstar/server + workstar-router
DOM hydration/mount ─────► shared template model + reactivity
server rendering    ─────► shared template model + attribute rules
shared model        ─────► reactivity
reactivity          ─────► no browser or package dependency
workstar-router     ─────► no Workstar or DOM dependency
```

`src/reactivity.ts` owns signals, lazy derived values, effect dependency tracking, and a microtask scheduler. It has no DOM import. Dependencies are tracked only while an effect or computed value is evaluated. Effects have explicit disposers and computed values detach from sources when no one observes them.

`src/template-model.ts` defines the template and directive contract. `src/attribute-value.ts` is the single validation rule for dynamic attributes in both rendering environments. `src/template.ts` owns DOM ranges, event/attribute bindings, hydration, and view scopes. Static markup is parsed once per template instance; updates touch only dynamic ranges. Nested scopes dispose their listeners and effects when replaced. `mount()` owns a host and makes remount/dispose idempotent.

`src/server.ts` renders escaped HTML and deterministic slot markers without a DOM. `hydrate()` attaches to those markers, preserves the initial server DOM, rejects mismatched dynamic content, and then uses the same reactive bindings as `mount()`. The server module has no dependency on the DOM module. A Chromium proof checks that a server-rendered button keeps its identity while becoming interactive.

`bin/workstar.js` scaffolds `templates/basic` (Vite static app) or `templates/worker` (SSR Cloudflare Worker). Neither the CLI nor the runtime imports a starter. Cloudflare dependencies live only in the Worker template, not in the core or `workstar-app`.

`packages/router` is a separate package in the same repository. It owns shared URL matching and link generation, not DOM rendering or request handling. `packages/app` composes it with DOM-free SSR in a Fetch-native handler; it owns method dispatch, document metadata, status codes, and redirects, not platform bindings or application-specific form validation. Native page loads remain the default. Optional client transitions can be added later without coupling the reactive core to navigation.

## Influences and deliberate differences

- [Vue's reactive refs and computed values](https://vuejs.org/guide/extras/reactivity-in-depth.html) inform the state API; Workstar uses only shallow signals for now, not deep reactive proxies.
- [Svelte's compiled DOM updates](https://svelte.dev/) inform the goal, but Workstar has no compiler or Svelte compatibility layer.
- [Lit's tagged-template expressions](https://lit.dev/docs/templates/overview/) inform the HTML API; Workstar adds direct signal tracking and local cleanup scopes.

The runtime avoids a virtual DOM and a compiler in the first release. This keeps the starter small, but it means there is no compile-time optimization or complete template syntax checking. We will only add a compiler if benchmarks and real applications show a material benefit.

## Acceptance gates

1. Strict TypeScript checks, deterministic unit tests, and a production starter build must pass.
2. The runtime must remain below 8 KiB gzip as a regression budget; this is a size constraint, not a speed claim.
3. Browser tests must cover real interaction, keyboard focus, text safety, remounting, and cleanup before a stable release.
4. The HTTP layer and Worker template work locally, but are not evidence of full SvelteKit parity. Accessible form controls, list reconciliation, server-only boundary tests, and complete-site browser coverage are still prerequisites for replacing critical pages.
5. The Workstar Lab migration must keep server-rendered content, metadata, locales, contact delivery and uploads, no-JavaScript form submission, and Cloudflare deployment working before a cutover.

The first alpha is not a claim of parity with Vue, Svelte, or their ecosystems. Benchmarking must use repeatable browser workloads rather than marketing statements.
