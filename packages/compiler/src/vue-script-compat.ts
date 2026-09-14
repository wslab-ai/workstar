import ts from 'typescript';
import { reject } from './compat-rules.js';

export interface VueScriptCompat {
  readonly props: string;
  readonly setup: string;
  readonly refs: ReadonlySet<string>;
  readonly stores: ReadonlyMap<string, ReadonlySet<string>>;
}

function primitive(node: ts.Expression): boolean {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    (ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand))
  );
}

function propsCall(
  statement: ts.Statement,
  file: ts.SourceFile,
  filename: string,
): ts.TypeLiteralNode | undefined {
  let call: ts.CallExpression | undefined;
  if (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression)
  ) {
    call = statement.expression;
  } else if (
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.length === 1
  ) {
    const declaration = statement.declarationList.declarations[0]!;
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === 'props' &&
      !declaration.type &&
      declaration.initializer &&
      ts.isCallExpression(declaration.initializer)
    ) {
      call = declaration.initializer;
    }
  }
  if (!call || call.expression.getText(file) !== 'defineProps') return;
  const type = call.typeArguments?.[0];
  if (
    call.arguments.length ||
    call.typeArguments?.length !== 1 ||
    !type ||
    !ts.isTypeLiteralNode(type)
  ) {
    reject(filename, 'defineProps type');
  }
  return type;
}

function vueImport(
  statement: ts.ImportDeclaration,
  filename: string,
): ReadonlySet<string> {
  const named = statement.importClause?.namedBindings;
  if (
    !ts.isStringLiteral(statement.moduleSpecifier) ||
    statement.moduleSpecifier.text !== 'vue' ||
    statement.importClause?.isTypeOnly ||
    !named ||
    !ts.isNamedImports(named) ||
    named.elements.length === 0 ||
    named.elements.some(
      (entry) =>
        entry.propertyName || !['ref', 'reactive'].includes(entry.name.text),
    )
  ) {
    reject(filename, 'script import');
  }
  const apis = new Set(named.elements.map((entry) => entry.name.text));
  if (apis.size !== named.elements.length) reject(filename, 'script import');
  return apis;
}

interface StateDeclaration {
  readonly name: string;
  readonly kind: 'ref' | 'reactive';
  readonly code: string;
  readonly fields?: ReadonlySet<string>;
}

function stateDeclaration(
  statement: ts.Statement,
  file: ts.SourceFile,
  filename: string,
): StateDeclaration | undefined {
  if (!ts.isVariableStatement(statement)) return;
  if (
    (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
    statement.modifiers?.length ||
    statement.declarationList.declarations.length !== 1
  ) {
    reject(filename, 'state declaration');
  }
  const declaration = statement.declarationList.declarations[0]!;
  const initializer = declaration.initializer;
  if (
    !ts.isIdentifier(declaration.name) ||
    declaration.name.text === 'props' ||
    ['__workstarSignal', '__workstarStore'].includes(declaration.name.text) ||
    declaration.type ||
    !initializer ||
    !ts.isCallExpression(initializer) ||
    initializer.arguments.length !== 1
  ) {
    reject(filename, 'primitive state declaration');
  }
  const kind = initializer.expression.getText(file);
  if (kind === 'reactive') {
    const record = initializer.arguments[0]!;
    if (
      initializer.typeArguments?.length ||
      !ts.isObjectLiteralExpression(record) ||
      record.properties.length === 0
    ) {
      reject(filename, 'flat reactive declaration');
    }
    const fields = new Set<string>();
    for (const property of record.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !ts.isIdentifier(property.name) ||
        !primitive(property.initializer) ||
        fields.has(property.name.text) ||
        property.name.text === '__proto__'
      ) {
        reject(filename, 'flat reactive declaration');
      }
      fields.add(property.name.text);
    }
    return {
      name: declaration.name.text,
      kind,
      fields,
      code: `const ${declaration.name.text} = __workstarStore(${record.getText(file)});`,
    };
  }
  if (
    kind !== 'ref' ||
    !primitive(initializer.arguments[0]!) ||
    (initializer.typeArguments?.length ?? 0) > 1
  ) {
    reject(filename, 'primitive ref declaration');
  }
  const type = initializer.typeArguments?.[0];
  return {
    name: declaration.name.text,
    kind,
    code:
      'const ' +
      declaration.name.text +
      ' = __workstarSignal' +
      (type ? '<' + type.getText(file) + '>' : '') +
      '(' +
      initializer.arguments[0]!.getText(file) +
      ');',
  };
}

function writableState(
  node: ts.Expression,
  refs: ReadonlySet<string>,
  stores: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression))
    return false;
  const owner = node.expression.text;
  return (
    (refs.has(owner) && node.name.text === 'value') ||
    stores.get(owner)?.has(node.name.text) === true
  );
}

function stateWrite(
  expression: ts.Expression,
  refs: ReadonlySet<string>,
  stores: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (
    ts.isPostfixUnaryExpression(expression) ||
    ts.isPrefixUnaryExpression(expression)
  ) {
    return (
      (expression.operator === ts.SyntaxKind.PlusPlusToken ||
        expression.operator === ts.SyntaxKind.MinusMinusToken) &&
      writableState(expression.operand, refs, stores)
    );
  }
  return (
    ts.isBinaryExpression(expression) &&
    writableState(expression.left, refs, stores) &&
    [
      ts.SyntaxKind.EqualsToken,
      ts.SyntaxKind.PlusEqualsToken,
      ts.SyntaxKind.MinusEqualsToken,
    ].includes(expression.operatorToken.kind) &&
    primitive(expression.right)
  );
}

function stateHandler(
  statement: ts.FunctionDeclaration,
  refs: ReadonlySet<string>,
  stores: ReadonlyMap<string, ReadonlySet<string>>,
  file: ts.SourceFile,
  filename: string,
): { name: string; code: string } {
  if (
    !statement.name ||
    !statement.body ||
    statement.modifiers?.length ||
    statement.asteriskToken ||
    statement.typeParameters?.length ||
    statement.parameters.length ||
    statement.body.statements.length === 0 ||
    statement.body.statements.some(
      (entry) =>
        !ts.isExpressionStatement(entry) ||
        !stateWrite(entry.expression, refs, stores),
    )
  ) {
    reject(filename, 'state event handler');
  }
  return { name: statement.name.text, code: statement.getText(file) };
}

/** Translate primitive Vue refs, flat reactive records, props, and their handlers. */
export function convertVueScript(
  script: string,
  filename: string,
): VueScriptCompat {
  const diagnostics =
    ts.transpileModule(script, {
      fileName: filename,
      reportDiagnostics: true,
    }).diagnostics ?? [];
  if (
    diagnostics.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    reject(filename, 'invalid script setup syntax');
  }
  const file = ts.createSourceFile(
    filename,
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let props = '';
  let importedApis: ReadonlySet<string> = new Set();
  let hasImport = false;
  const names = new Set(['props', '__workstarSignal', '__workstarStore']);
  const refs = new Set<string>();
  const stores = new Map<string, ReadonlySet<string>>();
  const setup: string[] = [];
  const handlers: ts.FunctionDeclaration[] = [];
  for (const statement of file.statements) {
    if (ts.isEmptyStatement(statement)) continue;
    const type = propsCall(statement, file, filename);
    if (type) {
      if (props) reject(filename, 'duplicate defineProps');
      props = 'export type Props = ' + type.getText(file) + ';';
      for (const member of type.members) {
        if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name))
          reject(filename, 'Props property');
        if (names.has(member.name.text))
          reject(filename, 'reserved or duplicate Props property');
        names.add(member.name.text);
      }
      continue;
    }
    if (ts.isImportDeclaration(statement)) {
      if (hasImport) reject(filename, 'script import');
      importedApis = vueImport(statement, filename);
      hasImport = true;
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const declaration = stateDeclaration(statement, file, filename);
      if (!declaration || names.has(declaration.name))
        reject(filename, 'state declaration');
      names.add(declaration.name);
      if (declaration.kind === 'ref') refs.add(declaration.name);
      else stores.set(declaration.name, declaration.fields!);
      setup.push(declaration.code);
      continue;
    }
    if (ts.isFunctionDeclaration(statement)) {
      handlers.push(statement);
      continue;
    }
    reject(filename, 'script setup logic');
  }
  const usedApis = new Set<string>();
  if (refs.size) usedApis.add('ref');
  if (stores.size) usedApis.add('reactive');
  if (
    usedApis.size !== importedApis.size ||
    [...usedApis].some((api) => !importedApis.has(api))
  ) {
    reject(filename, 'unsupported or unused Vue reactivity import');
  }
  for (const handler of handlers) {
    const converted = stateHandler(handler, refs, stores, file, filename);
    if (names.has(converted.name)) reject(filename, 'handler name');
    names.add(converted.name);
    setup.push(converted.code);
  }
  return {
    props,
    setup:
      (refs.size
        ? "import { signal as __workstarSignal } from 'workstar';\n"
        : '') +
      (stores.size
        ? "import { store as __workstarStore } from 'workstar';\n"
        : '') +
      setup.join('\n'),
    refs,
    stores,
  };
}
