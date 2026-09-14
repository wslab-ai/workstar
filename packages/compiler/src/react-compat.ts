import ts from 'typescript';
import { pathExpression, reject } from './compat-rules.js';

const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const nativeEvents = new Map([
  ['onBlur', 'blur'],
  ['onClick', 'click'],
  ['onDoubleClick', 'dblclick'],
  ['onFocus', 'focus'],
  ['onInput', 'input'],
  ['onKeyDown', 'keydown'],
  ['onKeyUp', 'keyup'],
  ['onMouseEnter', 'mouseenter'],
  ['onMouseLeave', 'mouseleave'],
  ['onPointerDown', 'pointerdown'],
  ['onPointerMove', 'pointermove'],
  ['onPointerUp', 'pointerup'],
  ['onSubmit', 'submit'],
  ['onTouchEnd', 'touchend'],
  ['onTouchMove', 'touchmove'],
  ['onTouchStart', 'touchstart'],
]);

function expression(
  node: ts.Expression,
  file: ts.SourceFile,
  filename: string,
  setup: string[],
  defaults: readonly ts.BindingElement[],
): string {
  const value = node.getText(file);
  if (pathExpression.test(value) && defaults.length === 0)
    return '{' + value + '}';
  if (!isStatelessExpression(node)) reject(filename, 'expression ' + value);
  const name = `__workstarExpression${setup.length}`;
  const bindings = defaults.map((element) => element.getText(file)).join(', ');
  const argumentsList = defaults
    .map((element) => element.name.getText(file))
    .join(', ');
  const computed = defaults.length
    ? `((${bindings}) => (${value}))(${argumentsList})`
    : value;
  setup.push(`const ${name} = ${computed};`);
  return '{' + name + '}';
}

function isStatelessExpression(node: ts.Expression): boolean {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  )
    return true;
  if (ts.isParenthesizedExpression(node))
    return isStatelessExpression(node.expression);
  if (ts.isPropertyAccessExpression(node))
    return isStatelessExpression(node.expression);
  if (ts.isTemplateExpression(node))
    return node.templateSpans.every((span) =>
      isStatelessExpression(span.expression),
    );
  if (ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return (
      isStatelessExpression(node.left) && isStatelessExpression(node.right)
    );
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'trim' &&
    node.arguments.length === 0 &&
    isStatelessExpression(node.expression.expression)
  );
}

function attributeName(original: string, filename: string): string {
  if (original === 'className') return 'class';
  if (original === 'htmlFor') return 'for';
  if (/^on[A-Z]/.test(original)) {
    const event = nativeEvents.get(original);
    if (!event) reject(filename, 'event ' + original);
    return 'on:' + event;
  }
  return original;
}

function attributes(
  input: ts.JsxAttributes,
  file: ts.SourceFile,
  filename: string,
  setup: string[],
  defaults: readonly ts.BindingElement[],
  component = false,
  restName?: string,
): string {
  let output = '';
  for (const attribute of input.properties) {
    if (ts.isJsxSpreadAttribute(attribute)) {
      if (
        component ||
        !restName ||
        !ts.isIdentifier(attribute.expression) ||
        attribute.expression.text !== restName
      )
        reject(filename, 'spread attribute');
      output += ' bind:attrs={__workstarRest}';
      continue;
    }
    if (!ts.isIdentifier(attribute.name))
      reject(filename, 'namespaced JSX attribute');
    const original = attribute.name.text;
    if (
      ['style', 'ref', 'key', 'dangerouslySetInnerHTML'].includes(original) ||
      (!component && original === 'onChange')
    ) {
      reject(filename, 'attribute ' + original);
    }
    const name = component ? original : attributeName(original, filename);
    if (!/^[a-z][a-z0-9:._-]*$/i.test(name))
      reject(filename, 'attribute ' + original);
    if (component && !/^[A-Za-z_$][\w$]*$/.test(name))
      reject(filename, 'component prop ' + original);
    if (!attribute.initializer) {
      output += ' ' + name + (component ? '' : '=""');
    } else if (ts.isStringLiteral(attribute.initializer)) {
      output +=
        ' ' +
        name +
        '="' +
        attribute.initializer.text
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;') +
        '"';
    } else if (
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression
    ) {
      output +=
        ' ' +
        name +
        '=' +
        expression(
          attribute.initializer.expression,
          file,
          filename,
          setup,
          defaults,
        );
    } else {
      reject(filename, 'attribute ' + original);
    }
  }
  return output;
}

function jsx(
  node: ts.JsxChild | ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
  file: ts.SourceFile,
  filename: string,
  setup: string[],
  defaults: readonly ts.BindingElement[],
  components: ReadonlySet<string>,
  restName?: string,
): string {
  if (ts.isJsxText(node)) {
    const value = node.getText(file);
    if (/[{}]/.test(value)) reject(filename, 'literal JSX braces');
    return value;
  }
  if (ts.isJsxExpression(node)) {
    if (!node.expression) reject(filename, 'empty JSX expression');
    return expression(node.expression, file, filename, setup, defaults);
  }
  if (ts.isJsxFragment(node))
    return node.children
      .map((child) =>
        jsx(child, file, filename, setup, defaults, components, restName),
      )
      .join('');
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const tag = opening.tagName.getText(file);
  const component = components.has(tag);
  if (!component && !/^[a-z][a-z0-9-]*$/.test(tag))
    reject(filename, 'component or tag ' + tag);
  const start =
    (component ? `<Use component={${tag}}` : `<${tag}`) +
    attributes(
      opening.attributes,
      file,
      filename,
      setup,
      defaults,
      component,
      restName,
    ) +
    '>';
  if (voidTags.has(tag)) {
    if (ts.isJsxElement(node)) reject(filename, 'children of ' + tag);
    return start;
  }
  const children = ts.isJsxElement(node)
    ? node.children
        .map((child) =>
          jsx(child, file, filename, setup, defaults, components, restName),
        )
        .join('')
    : '';
  return start + children + (component ? '</Use>' : `</${tag}>`);
}

function exportedComponent(
  file: ts.SourceFile,
  filename: string,
): ts.FunctionDeclaration {
  const components = file.statements.filter(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) === true,
  );
  if (components.length !== 1 || !components[0]?.body)
    reject(filename, 'one exported function component');
  return components[0];
}

/** The source export used by a named TSX import; undefined means default export. */
export function reactComponentExportName(
  source: string,
  filename = 'Component.tsx',
): string | undefined {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const component = exportedComponent(file, filename);
  return component.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
  )
    ? undefined
    : component.name?.text;
}

/** Converts one typed, stateless exported function component; unsupported behavior fails closed. */
export function convertReactComponent(
  source: string,
  filename = 'Component.tsx',
  options: {
    resolveReactImport?: (specifier: string) => string | undefined;
  } = {},
): string {
  const diagnostics =
    ts.transpileModule(source, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve },
    }).diagnostics ?? [];
  if (
    diagnostics.some(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    )
  ) {
    reject(filename, 'invalid TSX syntax');
  }
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const component = exportedComponent(file, filename);
  if (!component.body) reject(filename, 'component body');
  if (
    component.asteriskToken ||
    component.modifiers?.some(
      (modifier) =>
        ![ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword].includes(
          modifier.kind,
        ),
    )
  )
    reject(filename, 'async or generator component');
  const declarations = file.statements.filter(
    (statement) => statement !== component,
  );
  const imports: string[] = [];
  const components = new Set<string>();
  const reactTypes = new Set<string>();
  for (const statement of declarations) {
    if (!ts.isImportDeclaration(statement)) continue;
    const original = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : '';
    const clause = statement.importClause;
    if (original === 'react' && clause?.isTypeOnly) {
      if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings))
        reject(filename, 'React type import');
      for (const binding of clause.namedBindings.elements) {
        reactTypes.add(binding.name.text);
      }
      imports.push(statement.getText(file));
      continue;
    }
    const rewritten =
      options.resolveReactImport?.(original) ??
      (original.endsWith('.tsx?workstar') ? original : undefined);
    if (!rewritten || !clause || clause.isTypeOnly)
      reject(filename, 'imports or module statements');
    if (clause.name) components.add(clause.name.text);
    if (clause.namedBindings) {
      if (!ts.isNamedImports(clause.namedBindings))
        reject(filename, 'namespace component import');
      for (const binding of clause.namedBindings.elements) {
        if (!binding.isTypeOnly) components.add(binding.name.text);
      }
    }
    const text = statement.getText(file);
    const start =
      statement.moduleSpecifier.getStart(file) - statement.getStart(file);
    const end = statement.moduleSpecifier.getEnd() - statement.getStart(file);
    imports.push(
      text.slice(0, start) + JSON.stringify(rewritten) + text.slice(end),
    );
  }
  const typeDeclarations = declarations.filter(
    (statement) => !ts.isImportDeclaration(statement),
  );
  if (
    typeDeclarations.some(
      (statement) =>
        !ts.isInterfaceDeclaration(statement) &&
        !ts.isTypeAliasDeclaration(statement),
    )
  ) {
    reject(filename, 'imports or module statements');
  }
  if (component.parameters.length > 1)
    reject(filename, 'multiple component parameters');
  const parameter = component.parameters[0];
  let props = '';
  const declaredProps = new Set<string>();
  if (parameter) {
    if (!ts.isObjectBindingPattern(parameter.name) || !parameter.type)
      reject(filename, 'typed destructured props');
    const binding = parameter.name;
    if (
      binding.elements.some(
        (element) =>
          !ts.isIdentifier(element.name) ||
          Boolean(element.propertyName) ||
          (Boolean(element.dotDotDotToken) &&
            element !== binding.elements.at(-1)) ||
          (element.initializer !== undefined &&
            !isLiteralDefault(element.initializer)),
      )
    )
      reject(filename, 'renamed, defaulted, or rest props');
    if (ts.isTypeLiteralNode(parameter.type)) {
      props = 'export type Props = ' + parameter.type.getText(file) + ';';
      for (const member of parameter.type.members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name))
          declaredProps.add(member.name.text);
      }
    } else if (
      ts.isTypeReferenceNode(parameter.type) &&
      ts.isIdentifier(parameter.type.typeName)
    ) {
      const typeName = parameter.type.typeName.text;
      const declaration = typeDeclarations.find(
        (statement) =>
          (ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement)) &&
          statement.name.text === typeName,
      );
      if (
        !declaration ||
        (!ts.isInterfaceDeclaration(declaration) &&
          !ts.isTypeAliasDeclaration(declaration))
      )
        reject(filename, 'Props declaration');
      if (
        (ts.isInterfaceDeclaration(declaration) &&
          declaration.heritageClauses?.some((clause) =>
            clause.types.some(
              (type) =>
                !ts.isIdentifier(type.expression) ||
                !reactTypes.has(type.expression.text) ||
                type.expression.text !== 'HTMLAttributes',
            ),
          )) ||
        (ts.isTypeAliasDeclaration(declaration) &&
          !ts.isTypeLiteralNode(declaration.type))
      ) {
        reject(filename, 'inherited or non-literal Props');
      }
      const members = ts.isInterfaceDeclaration(declaration)
        ? declaration.members
        : ts.isTypeAliasDeclaration(declaration) &&
            ts.isTypeLiteralNode(declaration.type)
          ? declaration.type.members
          : [];
      for (const member of members) {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name))
          declaredProps.add(member.name.text);
      }
      const declarationText = declaration.getText(file);
      const nameStart =
        declaration.name.getStart(file) - declaration.getStart(file);
      const nameEnd = declaration.name.getEnd() - declaration.getStart(file);
      props =
        (declaration.modifiers?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
          ? ''
          : 'export ') +
        declarationText.slice(0, nameStart) +
        'Props' +
        declarationText.slice(nameEnd);
    } else {
      reject(filename, 'Props type');
    }
  } else if (typeDeclarations.length) {
    reject(filename, 'unused module declarations');
  }
  const onlyStatement = component.body.statements[0];
  if (
    component.body.statements.length !== 1 ||
    !onlyStatement ||
    !ts.isReturnStatement(onlyStatement) ||
    !onlyStatement.expression
  )
    reject(filename, 'component logic');
  let view = onlyStatement.expression;
  while (ts.isParenthesizedExpression(view)) view = view.expression;
  if (
    !ts.isJsxElement(view) &&
    !ts.isJsxSelfClosingElement(view) &&
    !ts.isJsxFragment(view)
  ) {
    reject(filename, 'non-JSX return');
  }
  const setup: string[] = [];
  const defaults =
    parameter && ts.isObjectBindingPattern(parameter.name)
      ? parameter.name.elements.filter(
          (element) => element.initializer !== undefined,
        )
      : [];
  const elements =
    parameter && ts.isObjectBindingPattern(parameter.name)
      ? parameter.name.elements
      : [];
  const rest = elements.find((element) => element.dotDotDotToken);
  const restName =
    rest && ts.isIdentifier(rest.name) ? rest.name.text : undefined;
  const additionalBindings = elements
    .filter(
      (element) =>
        !element.dotDotDotToken &&
        ts.isIdentifier(element.name) &&
        !declaredProps.has(element.name.text),
    )
    .map((element) => element.name.getText(file));
  if (additionalBindings.length)
    setup.push(`const { ${additionalBindings.join(', ')} } = props;`);
  if (restName) {
    if (restName === '__workstarRest')
      reject(filename, 'reserved rest prop name');
    setup.push(
      `const __workstarRest = ((${parameter!.name.getText(file)}: Props) => ${restName})(props);`,
    );
  }
  const markup = jsx(
    view,
    file,
    filename,
    setup,
    defaults,
    components,
    restName,
  );
  const script = [...imports, props, ...setup].filter(Boolean).join('\n');
  return (
    (script ? '<script lang="ts">\n' + script + '\n</script>\n' : '') +
    markup +
    '\n'
  );
}

function isLiteralDefault(node: ts.Expression): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  );
}
