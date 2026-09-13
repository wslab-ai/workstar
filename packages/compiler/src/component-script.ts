import type { DefaultTreeAdapterTypes as Html } from 'parse5';
import ts from 'typescript';
import { ComponentCompileError } from './errors.js';

export interface ScriptStatement {
  readonly code: string;
  readonly sourceOffset?: number | undefined;
  readonly exact?: boolean;
}

function preserveLocalSignals(
  statement: ts.VariableStatement,
  file: ts.SourceFile,
  signalBindings: ReadonlySet<string>,
): string | undefined {
  const statementStart = statement.getStart(file);
  let code = statement.getText(file);
  const signals = statement.declarationList.declarations.flatMap(
    (declaration) => {
      const initializer = declaration.initializer;
      if (
        !ts.isIdentifier(declaration.name) ||
        !initializer ||
        !ts.isCallExpression(initializer) ||
        !ts.isIdentifier(initializer.expression) ||
        !signalBindings.has(initializer.expression.text)
      )
        return [];
      return [{ name: declaration.name.text, initializer }];
    },
  );
  for (const { name, initializer } of signals.reverse()) {
    const start = initializer.getStart(file) - statementStart;
    const end = initializer.getEnd() - statementStart;
    const original = code.slice(start, end);
    const retained = `__context?.state(${JSON.stringify(`${name}:${original}`)}, () => ${original})`;
    code =
      code.slice(0, start) + `(${retained} ?? ${original})` + code.slice(end);
  }
  return signals.length > 0 ? code : undefined;
}

export function componentScript(
  node: Html.Element,
  filename: string,
  componentImports: 'generated' | 'source',
  sourcePosition: (offset: number) => { line: number; column: number },
  rewriteRelativeImport?: (specifier: string) => string,
  hotState = false,
): {
  moduleStatements: ScriptStatement[];
  setupStatements: ScriptStatement[];
  props: string[];
} {
  if (
    node.attrs.length !== 1 ||
    node.attrs[0]?.name !== 'lang' ||
    node.attrs[0].value !== 'ts'
  ) {
    throw new ComponentCompileError(
      'The component script must be <script lang="ts">.',
      filename,
      node.sourceCodeLocation
        ? sourcePosition(node.sourceCodeLocation.startOffset)
        : undefined,
    );
  }
  const scriptStart = node.sourceCodeLocation?.startTag?.endOffset;
  const failAt = (message: string, offset = 0): never => {
    throw new ComponentCompileError(
      message,
      filename,
      scriptStart === undefined
        ? undefined
        : sourcePosition(scriptStart + offset),
    );
  };
  const script = node.childNodes
    .map((child) => {
      if (!('value' in child)) return failAt('Invalid script content.');
      return child.value;
    })
    .join('');
  const file = ts.createSourceFile(
    filename,
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const syntax = ts.transpileModule(script, {
    fileName: filename.replace(/\.workstar$/, '.ts'),
    reportDiagnostics: true,
  });
  const syntaxError = syntax.diagnostics?.find(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (syntaxError) {
    failAt(
      `Invalid TypeScript in component script: ${ts.flattenDiagnosticMessageText(syntaxError.messageText, ' ')}`,
      syntaxError.start ?? 0,
    );
  }
  let props: string[] | undefined;
  const signalBindings = new Set<string>();
  const moduleStatements: ScriptStatement[] = [];
  const setupStatements: ScriptStatement[] = [];
  for (const statement of file.statements) {
    if (ts.isEmptyStatement(statement)) continue;
    const sourceOffset =
      scriptStart === undefined
        ? undefined
        : scriptStart + statement.getStart(file);
    if (ts.isImportDeclaration(statement)) {
      const specifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      const named = statement.importClause?.namedBindings;
      if (specifier === 'workstar' && named && ts.isNamedImports(named)) {
        for (const binding of named.elements) {
          if ((binding.propertyName ?? binding.name).text === 'signal') {
            signalBindings.add(binding.name.text);
          }
        }
      }
      if (specifier.endsWith('.workstar')) {
        const binding = statement.importClause?.name?.text;
        if (
          !/^(?:\.{1,2}\/)+(?:[A-Za-z0-9][\w-]*\/)*[A-Za-z0-9][\w-]*\.workstar$/.test(
            specifier,
          ) ||
          !binding ||
          statement.importClause?.isTypeOnly ||
          statement.importClause?.namedBindings
        ) {
          failAt(
            'Import a relative .workstar view with a default import.',
            statement.getStart(file),
          );
        }
        moduleStatements.push({
          code: `import { render as ${binding} } from '${componentImports === 'source' ? specifier : specifier.slice(0, -'.workstar'.length)}';`,
          sourceOffset,
        });
      } else if (specifier.startsWith('.') && rewriteRelativeImport) {
        const importText = statement.getText(file);
        const start =
          statement.moduleSpecifier.getStart(file) - statement.getStart(file);
        const end =
          statement.moduleSpecifier.getEnd() - statement.getStart(file);
        moduleStatements.push({
          code:
            importText.slice(0, start) +
            JSON.stringify(rewriteRelativeImport(specifier)) +
            importText.slice(end),
          sourceOffset,
        });
      } else {
        moduleStatements.push({
          code: statement.getText(file),
          sourceOffset,
          exact: true,
        });
      }
      continue;
    }
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === 'Props'
    ) {
      if (props)
        failAt(
          'The component can declare Props only once.',
          statement.getStart(file),
        );
      props = statement.members.map((member) => {
        if (
          !ts.isPropertySignature(member) ||
          !member.name ||
          !ts.isIdentifier(member.name)
        ) {
          return failAt(
            'Props must use named properties.',
            member.getStart(file),
          );
        }
        return member.name.text;
      });
      moduleStatements.push({
        code: statement.getText(file),
        sourceOffset,
        exact: true,
      });
      continue;
    }
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === 'Props' &&
      ts.isTypeLiteralNode(statement.type)
    ) {
      if (props)
        failAt(
          'The component can declare Props only once.',
          statement.getStart(file),
        );
      props = statement.type.members.map((member) => {
        if (
          !ts.isPropertySignature(member) ||
          !member.name ||
          !ts.isIdentifier(member.name)
        ) {
          return failAt(
            'Props must use named properties.',
            member.getStart(file),
          );
        }
        return member.name.text;
      });
      moduleStatements.push({
        code: statement.getText(file),
        sourceOffset,
        exact: true,
      });
      continue;
    }
    if (
      ts.isVariableStatement(statement) ||
      ts.isFunctionDeclaration(statement)
    ) {
      if (
        statement.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        failAt(
          'Component-local declarations cannot be exported.',
          statement.getStart(file),
        );
      }
      const retained =
        hotState && ts.isVariableStatement(statement)
          ? preserveLocalSignals(statement, file, signalBindings)
          : undefined;
      setupStatements.push({
        code: retained ?? statement.getText(file),
        sourceOffset,
        exact: retained === undefined,
      });
      continue;
    }
    failAt(
      'Only imports, Props, and component-local variables/functions are supported in the script.',
      statement.getStart(file),
    );
  }
  if (!props) {
    props = [];
    moduleStatements.push({ code: 'type Props = Record<string, never>;' });
  }
  return {
    moduleStatements,
    setupStatements,
    props,
  };
}
