import * as vscode from 'vscode';
import { findComponentImports } from './component-imports';
import { registerDiagnostics } from './diagnostics';

export function activate(context: vscode.ExtensionContext): void {
  registerDiagnostics(context);
  const links = vscode.languages.registerDocumentLinkProvider(
    { language: 'workstar', scheme: 'file' },
    {
      async provideDocumentLinks(document, token) {
        const imports = findComponentImports(document.getText());
        const links = await Promise.all(
          imports.map(async ({ path, start, end }) => {
            const target = vscode.Uri.joinPath(document.uri, '..', path);
            try {
              await vscode.workspace.fs.stat(target);
            } catch {
              return undefined;
            }
            if (token.isCancellationRequested) return undefined;
            const range = new vscode.Range(
              document.positionAt(start),
              document.positionAt(end),
            );
            const link = new vscode.DocumentLink(range, target);
            link.tooltip = 'Open Workstar component';
            return link;
          }),
        );
        return links.filter((link): link is vscode.DocumentLink => !!link);
      },
    },
  );

  context.subscriptions.push(links);
}
