# Workstar Language Support

VS Code language support for `.workstar` components. It provides syntax scopes
for Workstar controls and path expressions, embedded TypeScript and CSS syntax,
bracket/comment configuration, and component snippets.

This first release is declarative: it does not provide compiler diagnostics,
TypeScript completion across component boundaries, or a language server. Run
your project's `npm run check` for compiler and type errors.

Download the VSIX from the [public release](https://github.com/wslab-ai/workstar/releases/tag/vscode-v0.1.0)
and use VS Code's “Install from VSIX...” command. For local development, run
`npm ci`, `npm test`, then `npm run package` in this directory. Marketplace
publication requires a registered publisher and is not part of this repository build.
