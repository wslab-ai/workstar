import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5';
import { componentScript } from './component-script.js';
import {
  ControlSyntaxError,
  controlAttribute,
  normalizeControls,
} from './control-elements.js';
import { ComponentCompileError, fail } from './errors.js';
import { ComponentCode, type SourceOrigin } from './source-origin.js';
import { compileStyle, StyleCompileError } from './styles.js';

export { ComponentCompileError } from './errors.js';

const pathExpression = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/;
const identifier = /^[A-Za-z_$][\w$]*$/;
const urlAttributes = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
]);
const voidElements = new Set([
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}

function escapeTemplate(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

type LocalBindings = ReadonlyMap<string, string>;

interface MarkupSource {
  readonly text: string;
  readonly hotState: boolean;
  readonly position: (normalizedOffset: number) => {
    line: number;
    column: number;
  };
}

function sourcePosition(
  source: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index++) {
    if (source[index] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function offsetAtPosition(
  source: string,
  line: number,
  column: number,
): number {
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const newline = source.indexOf('\n', offset);
    if (newline < 0) return source.length;
    offset = newline + 1;
  }
  return Math.min(offset + column - 1, source.length);
}

function controlName(node: Html.Element): string | undefined {
  return node.attrs.find((attribute) => attribute.name === controlAttribute)
    ?.value;
}

function elementChildren(node: Html.Element): Html.ChildNode[] {
  return node.tagName === 'template'
    ? (node as Html.Template).content.childNodes
    : node.childNodes;
}

function expression(
  value: string,
  filename: string,
  locals: LocalBindings,
): string {
  if (!pathExpression.test(value))
    fail(filename, `Unsupported expression: ${value}`);
  const root = /^[A-Za-z_$][\w$]*/.exec(value)?.[0];
  if (!root) fail(filename, `Unsupported expression: ${value}`);
  const local = locals.get(root);
  return local ? local + value.slice(root.length) : value;
}

function dynamicAttribute(
  value: string,
  filename: string,
  locals: LocalBindings,
): string | null {
  if (!value.startsWith('{') && !value.endsWith('}')) return null;
  if (!value.startsWith('{') || !value.endsWith('}')) {
    fail(filename, `Invalid attribute expression: ${value}`);
  }
  return expression(value.slice(1, -1).trim(), filename, locals);
}

function textMarkup(
  value: string,
  filename: string,
  locals: LocalBindings,
): string {
  let result = '';
  let start = 0;
  const pattern = /\{([^{}]+)\}/g;
  for (const match of value.matchAll(pattern)) {
    const index = match.index;
    const staticText = value.slice(start, index);
    if (/[{}]/.test(staticText)) fail(filename, 'Invalid text expression.');
    result += escapeTemplate(escapeHtml(staticText));
    result += '${() => ' + expression(match[1]!.trim(), filename, locals) + '}';
    start = index + match[0].length;
  }
  const remaining = value.slice(start);
  if (/[{}]/.test(remaining)) fail(filename, 'Invalid text expression.');
  return result + escapeTemplate(escapeHtml(remaining));
}

function childMarkup(
  children: Html.ChildNode[],
  filename: string,
  locals: LocalBindings,
  source: MarkupSource,
): string {
  return children
    .map((child) => nodeMarkup(child, filename, locals, source))
    .join('');
}

function assertControlElementsPreserved(
  authoredCount: number,
  body: Html.ChildNode[],
  filename: string,
): void {
  let parsed = 0;
  const visit = (nodes: Html.ChildNode[]): void => {
    for (const node of nodes) {
      if (!('tagName' in node)) continue;
      if (controlName(node)) parsed++;
      visit(elementChildren(node));
    }
  };
  visit(body);
  if (parsed !== authoredCount) {
    fail(
      filename,
      'A control element was discarded by the HTML parser in this context.',
    );
  }
}

function scopeMarkupElements(
  nodes: Html.ChildNode[],
  attribute: string,
  filename: string,
): void {
  for (const node of nodes) {
    if (!('tagName' in node)) continue;
    if (node.tagName !== 'template') {
      if (node.attrs.some((entry) => entry.name === attribute)) {
        fail(filename, `${attribute} is reserved for component styles.`);
      }
      node.attrs.push({ name: attribute, value: '' });
    }
    scopeMarkupElements(elementChildren(node), attribute, filename);
  }
}

function eachMarkup(
  node: Html.Element,
  filename: string,
  locals: LocalBindings,
  source: MarkupSource,
): string {
  const attributes = new Map(
    node.attrs
      .filter((attribute) => attribute.name !== controlAttribute)
      .map((attribute) => [attribute.name, attribute.value]),
  );
  if (
    attributes.size !== 3 ||
    !attributes.has('each') ||
    !attributes.has('as') ||
    !attributes.has('key')
  ) {
    fail(
      filename,
      '<Each> needs each={path}, as="name", and key="field|self".',
    );
  }
  const collection = dynamicAttribute(
    attributes.get('each')!,
    filename,
    locals,
  );
  const name = attributes.get('as')!;
  const key = attributes.get('key')!;
  if (!collection || !identifier.test(name))
    fail(filename, 'Invalid <Each> binding.');
  if (key !== 'self' && !identifier.test(key))
    fail(filename, '<Each> key must be a field name or "self".');
  const nested = new Map(locals);
  nested.set(name, `${name}.value`);
  if (source.hotState) {
    const parent = locals.get('__workstarContext') ?? '__context';
    const itemKey = key === 'self' ? `${name}.value` : `${name}.value.${key}`;
    nested.set(
      '__workstarContext',
      `${parent}?.child('each:${node.sourceCodeLocation?.startOffset}')?.child(${itemKey})`,
    );
  }
  const body = childMarkup(elementChildren(node), filename, nested, source);
  const keyExpression = key === 'self' ? name : `${name}.${key}`;
  return (
    '${__repeat(() => ' +
    collection +
    ', (' +
    name +
    ') => ' +
    keyExpression +
    ', (' +
    name +
    ') => __html`' +
    body +
    '`)}'
  );
}

function ifMarkup(
  node: Html.Element,
  filename: string,
  locals: LocalBindings,
  source: MarkupSource,
): string {
  const attributes = node.attrs.filter(
    (attribute) => attribute.name !== controlAttribute,
  );
  if (attributes.length !== 1 || attributes[0]?.name !== 'when') {
    fail(filename, '<If> needs exactly when={path}.');
  }
  const condition = dynamicAttribute(attributes[0].value, filename, locals);
  if (!condition) fail(filename, '<If> needs a condition expression.');
  const children = elementChildren(node);
  const elseIndex = children.findIndex(
    (child) => 'tagName' in child && controlName(child) === 'Else',
  );
  const before = elseIndex < 0 ? children : children.slice(0, elseIndex);
  let alternate = 'null';
  if (elseIndex >= 0) {
    const elseNode = children[elseIndex];
    if (
      !elseNode ||
      !('tagName' in elseNode) ||
      elseNode.attrs.some((attribute) => attribute.name !== controlAttribute)
    ) {
      fail(filename, '<Else> cannot have attributes.');
    }
    if (
      children
        .slice(elseIndex + 1)
        .some((child) => !('value' in child) || child.value.trim() !== '')
    ) {
      fail(filename, '<Else> must be the last child of <If>.');
    }
    alternate =
      '__html`' +
      childMarkup(elementChildren(elseNode), filename, locals, source) +
      '`';
  }
  const truthy =
    '__html`' + childMarkup(before, filename, locals, source) + '`';
  return '${() => (' + condition + ' ? ' + truthy + ' : ' + alternate + ')}';
}

function originalAttributeName(
  node: Html.Element,
  name: string,
  source: string,
): string {
  const location = node.sourceCodeLocation?.attrs?.[name];
  if (!location) return name;
  return /^([^\s=/>]+)/.exec(source.slice(location.startOffset))?.[1] ?? name;
}

function componentMarkup(
  node: Html.Element,
  filename: string,
  locals: LocalBindings,
  source: MarkupSource,
): string {
  const children = elementChildren(node);
  const hasChildren = children.some(
    (child) => !('value' in child) || child.value.trim(),
  );
  const binding = node.attrs.find(
    (attribute) => attribute.name === 'component',
  );
  if (!binding) fail(filename, '<Use> needs component={ImportedView}.');
  const renderer = dynamicAttribute(binding.value, filename, locals);
  if (!renderer) fail(filename, '<Use> needs a component expression.');
  const props = node.attrs
    .filter(
      (attribute) =>
        attribute !== binding && attribute.name !== controlAttribute,
    )
    .map((attribute) => {
      const name = originalAttributeName(node, attribute.name, source.text);
      if (!identifier.test(name)) {
        fail(filename, `<Use> prop ${name} must be a TypeScript identifier.`);
      }
      const value = dynamicAttribute(attribute.value, filename, locals);
      const authored = node.sourceCodeLocation?.attrs?.[attribute.name];
      const raw = authored
        ? source.text.slice(authored.startOffset, authored.endOffset)
        : '';
      const output =
        value ?? (raw.includes('=') ? JSON.stringify(attribute.value) : 'true');
      return `${name}: ${output}`;
    });
  if (hasChildren) {
    if (node.attrs.some((attribute) => attribute.name === 'children')) {
      fail(filename, '<Use> cannot set children twice.');
    }
    props.push(
      'children: __html`' +
        childMarkup(children, filename, locals, source) +
        '`',
    );
  }
  const context = locals.get('__workstarContext') ?? '__context';
  const hotArgument = source.hotState
    ? `, ${context}?.child('use:${node.sourceCodeLocation?.startOffset}')`
    : '';
  return (
    '${() => ' + renderer + '({' + props.join(', ') + '}' + hotArgument + ')}'
  );
}

function elementMarkup(
  node: Html.Element,
  filename: string,
  locals: LocalBindings,
  source: MarkupSource,
): string {
  if (!node.sourceCodeLocation)
    fail(filename, 'HTML parser inserted an implicit element.');
  const tag = node.tagName;
  if (tag === 'template') {
    switch (controlName(node)) {
      case 'Each':
        return eachMarkup(node, filename, locals, source);
      case 'If':
        return ifMarkup(node, filename, locals, source);
      case 'Else':
        fail(filename, '<Else> must be inside <If>.');
      case 'Use':
        return componentMarkup(node, filename, locals, source);
      default:
        fail(filename, '<template> is not supported in component markup yet.');
    }
  }
  if (/^(script|style|title)$/.test(tag)) {
    fail(filename, `<${tag}> is not supported in component markup yet.`);
  }
  if (
    tag === 'noscript' &&
    node.childNodes.some(
      (child) =>
        !('value' in child) ||
        /\{[^{}]+\}|<\s*\/?\s*[a-z][^>]*>/i.test(child.value),
    )
  ) {
    fail(
      filename,
      '<noscript> supports static text only; place links and expressions outside it.',
    );
  }
  let result = `<${tag}`;
  for (const attribute of node.attrs) {
    const name = attribute.name;
    if (tag === 'textarea' && name === 'value') {
      fail(filename, '<textarea> value belongs in element content.');
    }
    if (name === 'srcdoc') fail(filename, 'srcdoc is not supported.');
    if (/^on/i.test(name) && !name.startsWith('on:')) {
      fail(filename, `Use on:event instead of ${name}.`);
    }
    const value = dynamicAttribute(attribute.value, filename, locals);
    if (name.startsWith('on:')) {
      if (!value) fail(filename, `${name} needs a handler expression.`);
      result += '${__on(' + JSON.stringify(name.slice(3)) + ', ' + value + ')}';
    } else if (value) {
      result += '${__attr(' + JSON.stringify(name) + ', () => ' + value + ')}';
    } else if (urlAttributes.has(name)) {
      result +=
        '${__attr(' +
        JSON.stringify(name) +
        ', ' +
        JSON.stringify(attribute.value) +
        ')}';
    } else {
      result += ` ${name}="${escapeTemplate(escapeHtml(attribute.value))}"`;
    }
  }
  if (tag === 'textarea') {
    const content = node.childNodes
      .map((child) => {
        if (!('value' in child)) {
          fail(filename, '<textarea> can contain text only.');
        }
        return child.value;
      })
      .join('');
    const dynamic = /^\s*\{([^{}]+)\}\s*$/.exec(content);
    if (dynamic) {
      const source = expression(dynamic[1]!.trim(), filename, locals);
      return result + '${__textareaValue(() => ' + source + ')}></textarea>';
    }
    if (/[{}]/.test(content)) {
      fail(filename, '<textarea> needs one {path} expression or static text.');
    }
    return result + '>' + escapeTemplate(escapeHtml(content)) + '</textarea>';
  }
  result += '>';
  if (voidElements.has(tag)) {
    if (node.childNodes.length > 0)
      fail(filename, `<${tag}> cannot have children.`);
    return result;
  }
  return (
    result +
    childMarkup(node.childNodes, filename, locals, source) +
    `</${tag}>`
  );
}

function nodeMarkup(
  node: Html.ChildNode,
  filename: string,
  locals: LocalBindings,
  source: MarkupSource,
): string {
  try {
    if ('tagName' in node) return elementMarkup(node, filename, locals, source);
    if ('value' in node) return textMarkup(node.value, filename, locals);
    if ('data' in node) return `<!--${escapeTemplate(node.data)}-->`;
    return fail(filename, 'Doctype belongs in the document shell.');
  } catch (error) {
    if (
      error instanceof ComponentCompileError &&
      !error.position &&
      node.sourceCodeLocation
    ) {
      throw new ComponentCompileError(
        error.description,
        filename,
        source.position(node.sourceCodeLocation.startOffset),
      );
    }
    throw error;
  }
}

/** Compile a typed component and its optional co-located stylesheet. */
export function compileComponentParts(
  source: string,
  filename = 'Component.workstar',
  options: {
    componentImports?: 'generated' | 'source';
    rewriteRelativeImport?: (specifier: string) => string;
    cssImport?: string;
    hotState?: boolean;
  } = {},
): { code: string; css: string; origins: SourceOrigin[] } {
  let normalized: ReturnType<typeof normalizeControls>;
  try {
    normalized = normalizeControls(source);
  } catch (error) {
    if (error instanceof ControlSyntaxError) {
      throw new ComponentCompileError(
        error.message,
        filename,
        sourcePosition(source, error.offset),
      );
    }
    fail(filename, error instanceof Error ? error.message : String(error));
  }
  const normalizedSource = normalized.source;
  const markupSource: MarkupSource = {
    text: normalizedSource,
    hotState: options.hotState ?? false,
    position: (offset) =>
      sourcePosition(source, normalized.originalOffset(offset)),
  };
  const errors: Array<{ code: string; startOffset: number }> = [];
  const fragment = parseFragment(normalizedSource, {
    sourceCodeLocationInfo: true,
    onParseError: (error) =>
      errors.push({ code: error.code, startOffset: error.startOffset }),
  });
  if (errors.length > 0) {
    const error = errors[0]!;
    throw new ComponentCompileError(
      error.code,
      filename,
      markupSource.position(error.startOffset),
    );
  }
  const content = fragment.childNodes.filter(
    (node) => !('value' in node) || node.value.trim().length > 0,
  );
  const first = content[0];
  const hasScript = first && 'tagName' in first && first.tagName === 'script';
  if (
    !hasScript &&
    content.some((node) => 'tagName' in node && node.tagName === 'script')
  ) {
    fail(filename, 'A <script lang="ts"> block must come first.');
  }
  const { moduleStatements, setupStatements, props } = hasScript
    ? componentScript(
        first,
        filename,
        options.componentImports ?? 'generated',
        markupSource.position,
        options.rewriteRelativeImport,
        options.hotState,
      )
    : {
        moduleStatements: [
          { code: 'export type Props = Record<string, never>;' },
        ],
        setupStatements: [],
        props: [],
      };
  const componentBody = hasScript ? content.slice(1) : content;
  const last = componentBody.at(-1);
  const hasStyle = last && 'tagName' in last && last.tagName === 'style';
  const markup = hasStyle ? componentBody.slice(0, -1) : componentBody;
  if (markup.some((node) => 'tagName' in node && node.tagName === 'style')) {
    fail(filename, 'A single <style> block must come last.');
  }
  let css = '';
  if (hasStyle) {
    const global =
      last.attrs.length === 1 &&
      last.attrs[0]?.name === 'global' &&
      last.attrs[0].value === '';
    if (last.attrs.length > 0 && !global) {
      fail(filename, 'Use <style> or <style global> only.');
    }
    const authoredCss = last.childNodes
      .map((child) => {
        if (!('value' in child)) fail(filename, 'Invalid <style> content.');
        return child.value;
      })
      .join('');
    try {
      const style = compileStyle(authoredCss, filename, global);
      css = style.css;
      if (style.scopeAttribute) {
        scopeMarkupElements(markup, style.scopeAttribute, filename);
      }
    } catch (error) {
      const cssStart = last.sourceCodeLocation?.startTag?.endOffset;
      if (error instanceof StyleCompileError && cssStart !== undefined) {
        throw new ComponentCompileError(
          error.message,
          filename,
          markupSource.position(
            cssStart + offsetAtPosition(authoredCss, error.line, error.column),
          ),
        );
      }
      fail(filename, error instanceof Error ? error.message : String(error));
    }
  }
  assertControlElementsPreserved(normalized.count, markup, filename);
  const body = childMarkup(markup, filename, new Map(), markupSource);
  if (body.trim().length === 0) fail(filename, 'The component has no markup.');
  const destructure =
    props.length > 0 ? `  const { ${props.join(', ')} } = props;\n` : '';
  const code = new ComponentCode();
  code.append(
    '// Generated by workstar-compiler. Edit the .workstar source instead.\n',
  );
  code.append(
    "import { html as __html, attr as __attr, on as __on, repeat as __repeat, textareaValue as __textareaValue } from 'workstar';\n",
  );
  if (options.hotState) {
    code.append(
      "import type { HotContext as __WorkstarHotContext } from 'workstar/dev';\n",
    );
  }
  if (css && options.cssImport) {
    code.append(`import ${JSON.stringify(options.cssImport)};\n`);
  }
  code.appendStatements(moduleStatements, normalized.originalOffset);
  code.append(
    options.hotState
      ? '\nexport function render(props: Props, __context?: __WorkstarHotContext) {\n'
      : '\nexport function render(props: Props) {\n',
  );
  code.append(destructure);
  code.appendStatements(setupStatements, normalized.originalOffset);
  code.append('\n  ');
  code.append(
    'return __html`',
    markup[0]?.sourceCodeLocation
      ? normalized.originalOffset(markup[0].sourceCodeLocation.startOffset)
      : undefined,
  );
  code.append(body);
  code.append('`;\n}\n');
  return { code: code.toString(), css, origins: code.origins };
}

/** Compile a component to a TypeScript module; use parts to emit its CSS. */
export function compileComponent(
  source: string,
  filename = 'Component.workstar',
  options: {
    componentImports?: 'generated' | 'source';
    rewriteRelativeImport?: (specifier: string) => string;
    cssImport?: string;
    hotState?: boolean;
  } = {},
): string {
  return compileComponentParts(source, filename, options).code;
}
