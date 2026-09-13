import * as vscode from 'vscode';
import { checkComponent, type ComponentCheck } from './compiler-check';

const changeDelayMs = 180;

function diagnosticRange(
  document: vscode.TextDocument,
  result: ComponentCheck,
): vscode.Range {
  const position = result.status === 'invalid' ? result.position : undefined;
  const line = Math.min(
    Math.max((position?.line ?? 1) - 1, 0),
    document.lineCount - 1,
  );
  const lineLength = document.lineAt(line).text.length;
  const column = Math.min(Math.max((position?.column ?? 1) - 1, 0), lineLength);
  return new vscode.Range(line, column, line, Math.min(column + 1, lineLength));
}

export function registerDiagnostics(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('workstar');
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  function clear(uri: vscode.Uri): void {
    const key = uri.toString();
    const timer = pending.get(key);
    if (timer) clearTimeout(timer);
    pending.delete(key);
    diagnostics.delete(uri);
  }

  async function validate(document: vscode.TextDocument): Promise<void> {
    if (document.languageId !== 'workstar' || document.uri.scheme !== 'file')
      return;
    if (!vscode.workspace.isTrusted) {
      diagnostics.delete(document.uri);
      return;
    }
    const version = document.version;
    const result = await checkComponent(
      document.getText(),
      document.uri.fsPath,
    );
    if (
      document.isClosed ||
      document.version !== version ||
      !vscode.workspace.isTrusted
    )
      return;
    if (result.status === 'valid') {
      diagnostics.delete(document.uri);
      return;
    }
    const severity =
      result.status === 'unavailable'
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Error;
    const diagnostic = new vscode.Diagnostic(
      diagnosticRange(document, result),
      result.message,
      severity,
    );
    diagnostic.source = 'Workstar';
    diagnostics.set(document.uri, [diagnostic]);
  }

  function schedule(
    document: vscode.TextDocument,
    delay = changeDelayMs,
  ): void {
    if (document.languageId !== 'workstar' || document.uri.scheme !== 'file')
      return;
    const key = document.uri.toString();
    const timer = pending.get(key);
    if (timer) clearTimeout(timer);
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        void validate(document);
      }, delay),
    );
  }

  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument((document) => schedule(document, 0)),
    vscode.workspace.onDidChangeTextDocument(({ document }) =>
      schedule(document),
    ),
    vscode.workspace.onDidSaveTextDocument((document) => schedule(document, 0)),
    vscode.workspace.onDidCloseTextDocument((document) => clear(document.uri)),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      for (const document of vscode.workspace.textDocuments)
        schedule(document, 0);
    }),
    {
      dispose: () => {
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
      },
    },
  );
  for (const document of vscode.workspace.textDocuments) schedule(document, 0);
}
