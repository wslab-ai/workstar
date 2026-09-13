# Workstar Language Support

VS Code language support for `.workstar` components. It provides syntax scopes
for Workstar controls and path expressions, embedded TypeScript and CSS syntax,
bracket/comment configuration, and component snippets. Use Ctrl/Cmd-click on an
existing relative `.workstar` import inside `<script>` to open the component.

For trusted projects with `workstar-compiler` installed, compiler errors appear
in the Problems panel while editing, including unsaved changes. The extension
uses the project's installed compiler so its accepted syntax matches the build.
Compiler versions that expose source positions report the original `.workstar`
line and column; older versions place an error at the start of the file. In an untrusted
workspace, syntax highlighting remains available but project code is not loaded.

The `.workstar` language contributes a file icon for themes that do not supply
their own Workstar icon. Your selected file icon theme remains in control.

The extension does not provide TypeScript semantic checking or completion across
component boundaries. Run your project's `npm run check` for those errors and
the full project build.

Install `wslab-ai.workstar-language` from the VS Code Extensions view. For
local development, run `npm ci`, `npm test`, then `npm run package` in this
directory and use VS Code's “Install from VSIX...” command. Marketplace
publication is separate from this repository build.
