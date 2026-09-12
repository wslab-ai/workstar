# Architecture

Workstar `0.1` has three independent concerns and a one-way dependency graph:

```text
CLI + starter  ─────► public package API
DOM templates  ─────► reactivity
reactivity     ─────► no browser or package dependency
```

`src/reactivity.ts` owns signals, lazy derived values, effect dependency tracking, and a microtask scheduler. It has no DOM import. Dependencies are tracked only while an effect or computed value is evaluated. Effects have explicit disposers and computed values detach from sources when no one observes them.

`src/template.ts` owns safe HTML interpolation, directive placement, DOM ranges, event/attribute bindings, and view scopes. Static markup is parsed once per template instance; updates touch only dynamic ranges. Strings interpolated into child positions become text nodes, and dynamic URL attributes allow only a small protocol list. Nested scopes dispose their listeners and effects when replaced. `mount()` owns a host and makes remount/dispose idempotent.

`bin/workstar.js` only scaffolds `templates/basic`; the starter owns its Vite build and static deployment. Neither the CLI nor the runtime imports the starter. No server, Cloudflare, or Svelte dependency is required in an application.

## Influences and deliberate differences

- Vue's explicit refs/computed values inform the state API; Workstar uses only shallow signals for now, not deep reactive proxies.
- Svelte's minimal browser work informs the goal, but Workstar has no compiler or Svelte compatibility layer.
- Lit's tagged-template expressions inform the HTML API; Workstar adds direct signal tracking and local cleanup scopes.

The runtime avoids a virtual DOM and a compiler in the first release. This keeps the starter small, but it means there is no compile-time optimization, template syntax checking, or hydration yet. We will only add a compiler if benchmarks and real applications show a material benefit.

## Acceptance gates

1. Strict TypeScript checks, deterministic unit tests, and a production starter build must pass.
2. The runtime must remain below 8 KiB gzip as a regression budget; this is a size constraint, not a speed claim.
3. Browser tests must cover real interaction, keyboard focus, text safety, remounting, and cleanup before a stable release.
4. SSR, hydration, and accessibility support for forms and lists are prerequisites for replacing any critical SvelteKit page.

The first alpha is not a claim of parity with Vue, Svelte, or their ecosystems. Benchmarking must use repeatable browser workloads rather than marketing statements.
