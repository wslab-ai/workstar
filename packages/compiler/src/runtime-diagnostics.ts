import ts from 'typescript';
import { ComponentCompileError } from './errors.js';

const supported = new Map<string, ReadonlySet<string>>([
  [
    'react',
    new Set([
      'Children',
      'Component',
      'Fragment',
      'StrictMode',
      'Suspense',
      'cloneElement',
      'createContext',
      'createElement',
      'createRef',
      'forwardRef',
      'isValidElement',
      'lazy',
      'memo',
      'useCallback',
      'useContext',
      'useDebugValue',
      'useEffect',
      'useId',
      'useImperativeHandle',
      'useLayoutEffect',
      'useMemo',
      'useReducer',
      'useRef',
      'useState',
      'useSyncExternalStore',
    ]),
  ],
  ['react-dom', new Set(['createPortal', 'flushSync'])],
  ['react-dom/client', new Set(['createRoot', 'hydrateRoot'])],
  ['react-dom/server', new Set(['renderToStaticMarkup', 'renderToString'])],
  [
    'react-router',
    new Set([
      'BrowserRouter',
      'Link',
      'NavLink',
      'Navigate',
      'Outlet',
      'Route',
      'Routes',
      'useLocation',
      'useNavigate',
      'useOutletContext',
      'useParams',
      'useSearchParams',
    ]),
  ],
]);

supported.set('react-router-dom', supported.get('react-router')!);

function failUnsupported(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  moduleName: string,
  exportName: string,
): never {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  throw new ComponentCompileError(
    `${moduleName} export ${exportName} is not implemented by the Workstar runtime. ` +
      `Supported exports: ${[...(supported.get(moduleName) ?? [])].join(', ')}.`,
    sourceFile.fileName,
    { line: position.line + 1, column: position.character + 1 },
  );
}

/** Fail early with file and symbol context for unsupported compatibility APIs. */
export function validateReactRuntimeSource(
  source: string,
  filename: string,
): void {
  if (
    !/['"]react(?:-dom(?:\/(?:client|server))?|-router(?:-dom)?)?['"]/.test(
      source,
    )
  )
    return;
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.[jt]sx$/.test(filename) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const namespaces = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : '';
    const exports = supported.get(moduleName);
    const clause = statement.importClause;
    if (!exports || !clause || clause.isTypeOnly) continue;
    if (clause.name) {
      if (moduleName === 'react' || moduleName === 'react-dom')
        namespaces.set(clause.name.text, moduleName);
      else failUnsupported(sourceFile, clause.name, moduleName, 'default');
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.set(bindings.name.text, moduleName);
      continue;
    }
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const exportName = element.propertyName?.text ?? element.name.text;
      if (!exports.has(exportName))
        failUnsupported(sourceFile, element, moduleName, exportName);
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const moduleName = namespaces.get(node.expression.text);
      if (moduleName && !supported.get(moduleName)?.has(node.name.text))
        failUnsupported(sourceFile, node.name, moduleName, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
