# Compatibility and release contract

The core (`workstar`), router, application layer, and compiler are published as
one tested release set. A starter pins each package it uses to that set's exact
version. `workstar-app` pins its router dependency and declares a matching core
peer range. `npm run check:release` checks these relationships before packing.

| Surface             | Supported contract                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime             | Modern browsers with native ES modules; no client framework dependency.                                                                                                                                                                                                                                                                                                                                                                   |
| Build and CLI       | Node.js 20 or newer for the compiler and server packages.                                                                                                                                                                                                                                                                                                                                                                                 |
| Static starter      | Vite 8 requires Node.js 20.19+ or 22.12+; `.workstar` source compiles in memory during development.                                                                                                                                                                                                                                                                                                                                       |
| Server starters     | Fetch-native `workstar-app` on Node.js or Cloudflare Workers.                                                                                                                                                                                                                                                                                                                                                                             |
| Source maps         | Vite JavaScript output maps script statements and the markup entry point back to authored `.workstar` files. Individual markup expressions are not mapped yet.                                                                                                                                                                                                                                                                            |
| Development updates | CSS-only edits retain mounted component state. The static starter accepts markup updates without a full page navigation, reuses directly declared local `signal()` state for the same component identity, and restores unfinished native form values, selection, and focus. Moving or replacing a component can change its identity; ordinary non-reactive local variables are recreated. File inputs cannot be restored by browser APIs. |

The benchmark command is `npm run bench`. It prints five-round medians for
fixed compile, server-render, browser mount, update, and hydration batches,
along with Node, browser, and platform versions. These are regression data,
not cross-framework comparisons or performance guarantees. Change the workload
only with a corresponding note in the release.

For a release, run `npm run verify`, `npm run bench`, and smoke-test the packed
static, Node, and Worker starters before publishing in dependency order:
router, core, app, compiler. Publish each package only once for a version.
Publish prereleases with `--tag next` for every package so the stable `latest`
tag remains unchanged during application trials.
