# workstar-app

Fetch-native HTTP layer for Workstar. It combines the separate `workstar-router` package with `workstar/server` to render pages and dispatch standard HTML form POSTs. `workstar` is a peer dependency: install one compatible copy of the core in the application so template identity remains shared. It has no Cloudflare-specific dependency; a Worker can call `app.fetch(request, env)` directly.

```ts
import { html } from 'workstar';
import { createApp, redirect } from 'workstar-app';

const app = createApp({
  routes: [
    {
      name: 'home',
      path: '/',
      page: () => ({
        lang: 'en',
        title: 'Home',
        content: html`<main><h1>Welcome</h1></main>`,
      }),
    },
  ],
});

export default {
  fetch(request: Request) {
    return app.fetch(request, {});
  },
};
```

Pages are server-rendered HTML by default. JavaScript is optional and must be added explicitly through `scripts`. Form actions receive the original `Request` so they can validate inputs and return redirects or validation responses. `readFormDataWithinLimit(request, maxBytes)` bounds form memory usage for URL-encoded and multipart bodies and returns typed `FormBodyError` statuses. Route matching, status handling, document metadata, and HTML escaping are provided here; authentication, upload storage, assets, prerendering, and deployment configuration remain the application's responsibility.
