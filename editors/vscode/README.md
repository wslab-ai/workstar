# Workstar Language Support

VS Code language support for `.workstar` components. It provides syntax scopes
for Workstar controls and path expressions, embedded TypeScript and CSS syntax,
bracket/comment configuration, and component snippets.

This first release is declarative: it does not provide compiler diagnostics,
TypeScript completion across component boundaries, or a language server. Run
your project's `npm run check` for compiler and type errors.

For local development, run `npm ci`, `npm test`, then `npm run package` in this
directory. Install the generated `dist/*.vsix` using VS Code's “Install from
VSIX...” command. Marketplace publication requires a registered publisher and
is not part of this repository build.
