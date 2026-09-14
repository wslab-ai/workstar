import ts from 'typescript';
import { reject } from './compat-rules.js';

function importedNames(statement: ts.ImportDeclaration): string[] {
  if (statement.importClause?.isTypeOnly || statement.importClause?.name)
    return [];
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];
  if (
    bindings.elements.some(
      (element) => element.isTypeOnly || element.propertyName,
    )
  )
    return [];
  return bindings.elements.map((element) => element.name.text);
}

function containsUnsupportedEntrySyntax(node: ts.Node): boolean {
  if (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node) ||
    (ts.isIdentifier(node) &&
      (node.text === 'createRoot' || node.text === 'StrictMode'))
  )
    return true;
  return ts.forEachChild(node, containsUnsupportedEntrySyntax) === true;
}

function singleComponent(
  node: ts.Expression,
  strictMode: boolean,
  filename: string,
): string {
  let element: ts.JsxChild | ts.Expression = node;
  if (ts.isJsxElement(element)) {
    if (
      !strictMode ||
      element.openingElement.tagName.getText() !== 'StrictMode' ||
      element.closingElement.tagName.getText() !== 'StrictMode'
    )
      reject(filename, 'React root entry');
    const children = element.children.filter(
      (child) => !ts.isJsxText(child) || child.getText().trim() !== '',
    );
    if (children.length !== 1) reject(filename, 'React root entry');
    element = children[0]!;
  }
  if (
    !ts.isJsxSelfClosingElement(element) ||
    element.attributes.properties.length !== 0 ||
    !ts.isIdentifier(element.tagName)
  )
    reject(filename, 'React root entry');
  return element.tagName.text;
}

/** Replace the conventional createRoot entry with a Workstar mount. */
export function convertReactRootEntry(
  source: string,
  filename: string,
): string | undefined {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = file.statements.filter(ts.isImportDeclaration);
  const rootImport = imports.find(
    (statement) =>
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'react-dom/client',
  );
  if (!rootImport) return undefined;
  const reactImport = imports.find(
    (statement) =>
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'react',
  );
  const strictMode = reactImport !== undefined;
  if (
    imports.filter(
      (entry) =>
        ts.isStringLiteral(entry.moduleSpecifier) &&
        entry.moduleSpecifier.text === 'react-dom/client',
    ).length !== 1 ||
    imports.filter(
      (entry) =>
        ts.isStringLiteral(entry.moduleSpecifier) &&
        entry.moduleSpecifier.text === 'react',
    ).length > 1 ||
    importedNames(rootImport).join(',') !== 'createRoot' ||
    (reactImport && importedNames(reactImport).join(',') !== 'StrictMode')
  )
    reject(filename, 'React root imports');

  const statement = file.statements.at(-1);
  if (!statement || !ts.isExpressionStatement(statement))
    reject(filename, 'React root entry');
  const renderCall = statement.expression;
  if (
    !ts.isCallExpression(renderCall) ||
    !ts.isPropertyAccessExpression(renderCall.expression) ||
    renderCall.expression.name.text !== 'render' ||
    renderCall.arguments.length !== 1
  )
    reject(filename, 'React root entry');
  const createCall = renderCall.expression.expression;
  if (
    !ts.isCallExpression(createCall) ||
    !ts.isIdentifier(createCall.expression) ||
    createCall.expression.text !== 'createRoot' ||
    createCall.arguments.length !== 1 ||
    !ts.isIdentifier(createCall.arguments[0]!)
  )
    reject(filename, 'React root entry');
  const component = singleComponent(
    renderCall.arguments[0]!,
    strictMode,
    filename,
  );
  if (
    !imports.some(
      (entry) =>
        ts.isStringLiteral(entry.moduleSpecifier) &&
        entry.moduleSpecifier.text.startsWith('.') &&
        importedNames(entry).includes(component),
    )
  )
    reject(filename, 'local root component import');
  if (
    file.statements.some(
      (entry) =>
        entry !== statement &&
        !ts.isImportDeclaration(entry) &&
        containsUnsupportedEntrySyntax(entry),
    )
  )
    reject(filename, 'extra React entry syntax');

  const edits = [
    { start: rootImport.getStart(file), end: rootImport.getEnd(), text: '' },
    ...(reactImport
      ? [
          {
            start: reactImport.getStart(file),
            end: reactImport.getEnd(),
            text: '',
          },
        ]
      : []),
    {
      start: statement.getStart(file),
      end: statement.getEnd(),
      text: `mount(${createCall.arguments[0]!.getText(file)}, ${component}({}));`,
    },
  ];
  let output = source;
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return `import { mount } from 'workstar';\n${output}`;
}
