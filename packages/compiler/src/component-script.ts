import type { DefaultTreeAdapterTypes as Html } from 'parse5';
import ts from 'typescript';
import { fail } from './errors.js';

export function componentScript(
  node: Html.Element,
  filename: string,
  componentImports: 'generated' | 'source',
  rewriteRelativeImport?: (specifier: string) => string,
): { moduleScript: string; setupScript: string; props: string[] } {
  if (
    node.attrs.length !== 1 ||
    node.attrs[0]?.name !== 'lang' ||
    node.attrs[0].value !== 'ts'
  ) {
    fail(filename, 'The component script must be <script lang="ts">.');
  }
  const script = node.childNodes
    .map((child) => {
      if (!('value' in child)) fail(filename, 'Invalid script content.');
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
  if (
    syntax.diagnostics?.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    fail(filename, 'Invalid TypeScript in component script.');
  }
  let props: string[] | undefined;
  const moduleStatements: string[] = [];
  const setupStatements: string[] = [];
  for (const statement of file.statements) {
    if (ts.isEmptyStatement(statement)) continue;
    if (ts.isImportDeclaration(statement)) {
      const specifier = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
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
          fail(
            filename,
            'Import a relative .workstar view with a default import.',
          );
        }
        moduleStatements.push(
          `import { render as ${binding} } from '${componentImports === 'source' ? specifier : specifier.slice(0, -'.workstar'.length)}';`,
        );
      } else if (specifier.startsWith('.') && rewriteRelativeImport) {
        const importText = statement.getText(file);
        const start =
          statement.moduleSpecifier.getStart(file) - statement.getStart(file);
        const end =
          statement.moduleSpecifier.getEnd() - statement.getStart(file);
        moduleStatements.push(
          importText.slice(0, start) +
            JSON.stringify(rewriteRelativeImport(specifier)) +
            importText.slice(end),
        );
      } else {
        moduleStatements.push(statement.getText(file));
      }
      continue;
    }
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === 'Props'
    ) {
      if (props) fail(filename, 'The component can declare Props only once.');
      props = statement.members.map((member) => {
        if (
          !ts.isPropertySignature(member) ||
          !member.name ||
          !ts.isIdentifier(member.name)
        ) {
          fail(filename, 'Props must use named properties.');
        }
        return member.name.text;
      });
      moduleStatements.push(statement.getText(file));
      continue;
    }
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === 'Props' &&
      ts.isTypeLiteralNode(statement.type)
    ) {
      if (props) fail(filename, 'The component can declare Props only once.');
      props = statement.type.members.map((member) => {
        if (
          !ts.isPropertySignature(member) ||
          !member.name ||
          !ts.isIdentifier(member.name)
        ) {
          fail(filename, 'Props must use named properties.');
        }
        return member.name.text;
      });
      moduleStatements.push(statement.getText(file));
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
        fail(filename, 'Component-local declarations cannot be exported.');
      }
      setupStatements.push(statement.getText(file));
      continue;
    }
    fail(
      filename,
      'Only imports, Props, and component-local variables/functions are supported in the script.',
    );
  }
  if (!props) {
    props = [];
    moduleStatements.push('type Props = Record<string, never>;');
  }
  return {
    moduleScript: moduleStatements.join('\n'),
    setupScript: setupStatements.join('\n'),
    props,
  };
}
