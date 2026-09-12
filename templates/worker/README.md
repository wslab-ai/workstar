# Workstar Worker starter

A server-rendered Workstar application for Cloudflare Workers. Static CSS is served by Cloudflare Assets; pages and standard HTML form actions run in the Worker. No client JavaScript is required for these routes.

The published starter pins matching versions of the core, router, app, and
compiler packages. When generated from a source checkout, the CLI instead links
those packages locally for development; keep the checkout available in that case.

```sh
npm install
npm run dev
npm run check
npm run deploy
```

Edit `.workstar` files anywhere under `src/`; this example uses `src/views/` by convention. `src/index.ts` holds route metadata and server actions. `npm run dev` compiles views and watches them while Wrangler serves the site; `npm run check` recompiles before type checking. Generated modules mirror source paths in the ignored `.workstar/generated/` directory outside `src`. Global CSS lives in `public/style.css`; a final `<style>` block in a component is scoped and compiled into the ignored `public/workstar.css`. Both stylesheets are linked in the server-rendered document, so CSS does not depend on JavaScript.
Static views need only markup; add a `<script lang="ts">` block with a `Props`
interface when a view receives data.

The contact action intentionally demonstrates validation and a redirect only; it does **not** send mail. Wire it to a server-side email service before using it as a production contact form. Keep secrets in Wrangler secrets or `.dev.vars`, never in source control.
