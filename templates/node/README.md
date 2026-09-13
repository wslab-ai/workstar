# Workstar Node.js starter

A server-rendered Workstar application on standard Node.js. The same
`workstar-app` route and action contract is used by other server adapters.
The example form validates and redirects; it does not store or send data.

```sh
npm install
npm run check
npm run dev
```

`npm run build && npm start` runs the compiled server. It listens on
`127.0.0.1:3000` by default; set `HOST` and `PORT` for deployment. Keep the
`public/` directory alongside `dist/` when deploying. `npm run dev` watches
components and TypeScript. Generated code stays in ignored `.workstar/`, not
authored `src/`.
