# Workstar Router

An experimental isomorphic URL matcher for Workstar applications. It has no DOM dependency and does not intercept links. The same route manifest can choose a server-rendered page and build browser links.

```ts
import { createRouter } from 'workstar-router';

const router = createRouter([
  {
    name: 'home',
    path: '/:locale?',
    validate: { locale: (value) => ['en', 'de'].includes(value) },
  },
  { name: 'service', path: '/:locale?/services/:service' },
] as const);

router.match('/de/services/audit');
router.href('service', { locale: 'de', service: 'audit' });
```

Static segments rank ahead of parameters. Optional parameters use `:name?`; final rest parameters use `*name`. Path parameters are decoded safely and link parameters are encoded. Native `<a href>` navigation remains the default, preserving server rendering and no-JavaScript behavior.
Use `validate` for constrained parameters such as supported locales; otherwise any non-empty segment is accepted.

This is not yet a client-side navigation system or a server framework. Request handling, data loading, form submissions, and page metadata belong to the application layer. MIT licensed.
