# Workstar Worker starter

A server-rendered Workstar application for Cloudflare Workers. Static CSS is served by Cloudflare Assets; pages and standard HTML form actions run in the Worker. No client JavaScript is required for these routes.

```sh
npm install
npm run dev
npm run check
npm run deploy
```

The contact action intentionally demonstrates validation and a redirect only; it does **not** send mail. Wire it to a server-side email service before using it as a production contact form. Keep secrets in Wrangler secrets or `.dev.vars`, never in source control.
