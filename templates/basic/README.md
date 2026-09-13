# Workstar starter

Run `npm install`, then `npm run dev`. The example page starts at `src/views/app.workstar`, but `views` is only a template convention: place `.workstar` components in any subdirectory of `src` and import them by relative `.workstar` path. Vite compiles those modules in memory during development and build. `npm run check` writes temporary TypeScript modules to the ignored `.workstar/` directory to validate component contracts. Run `npm run format` for TypeScript and `.workstar` files, and `npm run build` to create `dist/` for any static host.

Put component CSS in a final `<style>` block. Selectors are scoped by default; use `<style global>` only for intentional document-wide rules. Vite updates styles in development and extracts them into production CSS.

The example counter keeps its `signal` and click handler inside `app.workstar`. Each rendered component gets its own state; `main.ts` mounts the view and sets up a development update boundary. Markup edits retain directly declared local signals for the same component identity and restore unfinished native form fields. Put shared state in an imported TypeScript module when components need to share it.

This starter is client-rendered. It does not provide server rendering, hydration, routing, or data loading; use the Worker starter for SEO-critical content or forms that must work without JavaScript.
