import { parseFragment, type DefaultTreeAdapterTypes as Html } from 'parse5';
import { pathExpression, reject } from './compat-rules.js';
import { convertVueScript } from './vue-script-compat.js';

function content(source: string, node: Html.Element, filename: string): string {
  const location = node.sourceCodeLocation;
  if (!location?.startTag || !location.endTag)
    reject(filename, 'unclosed ' + node.tagName);
  return source.slice(location.startTag.endOffset, location.endTag.startOffset);
}

function templatePath(
  path: string,
  refs: ReadonlySet<string>,
  stores: ReadonlyMap<string, ReadonlySet<string>>,
  filename: string,
): string {
  if (!pathExpression.test(path)) reject(filename, 'expression ' + path);
  const root = path.split('.', 1)[0]!;
  const fields = stores.get(root);
  if (fields) {
    const field = path.slice(root.length + 1).split('.', 1)[0]!;
    if (!fields.has(field)) reject(filename, 'store field ' + path);
    return path;
  }
  if (!refs.has(root)) return path;
  const suffix = path.slice(root.length);
  if (suffix.startsWith('.value'))
    reject(filename, 'explicit .value in a Vue template');
  return root + '.value' + suffix;
}

/** Converts Vue SFC markup with typed defineProps and optional CSS. */
export function convertVueComponent(
  source: string,
  filename = 'Component.vue',
): string {
  const blockErrors: string[] = [];
  const fragment = parseFragment(source, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => blockErrors.push(error.code),
  });
  if (blockErrors.length)
    reject(filename, 'invalid SFC markup: ' + blockErrors[0]);
  const meaningful = fragment.childNodes.filter(
    (node) => !('value' in node) || node.value.trim(),
  );
  if (meaningful.some((node) => !('tagName' in node)))
    reject(filename, 'content outside SFC blocks');
  const blocks = meaningful as Html.Element[];
  if (
    blocks.some(
      (node) => !['template', 'script', 'style'].includes(node.tagName),
    )
  )
    reject(filename, 'unknown SFC block');
  const templates = blocks.filter((node) => node.tagName === 'template');
  const scripts = blocks.filter((node) => node.tagName === 'script');
  const styles = blocks.filter((node) => node.tagName === 'style');
  if (templates.length !== 1 || scripts.length > 1 || styles.length > 1)
    reject(filename, 'SFC block count');
  if (templates[0]!.attrs.length) reject(filename, 'template attributes');
  let scriptContent = '';
  let refs: ReadonlySet<string> = new Set();
  let stores: ReadonlyMap<string, ReadonlySet<string>> = new Map();
  if (scripts[0]) {
    const attrs = new Map(
      scripts[0].attrs.map((attribute) => [attribute.name, attribute.value]),
    );
    if (attrs.size !== 2 || !attrs.has('setup') || attrs.get('lang') !== 'ts')
      reject(filename, 'script setup attributes');
    const converted = convertVueScript(
      content(source, scripts[0], filename),
      filename,
    );
    scriptContent = [converted.props, converted.setup]
      .filter(Boolean)
      .join('\n');
    refs = converted.refs;
    stores = converted.stores;
  }
  let markup = content(source, templates[0]!, filename);
  const templateErrors: string[] = [];
  const templateTree = parseFragment(markup, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => templateErrors.push(error.code),
  });
  if (templateErrors.length)
    reject(filename, 'invalid template markup: ' + templateErrors[0]);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const visit = (nodes: Html.ChildNode[]): void => {
    for (const node of nodes) {
      if (!('tagName' in node)) {
        if ('value' in node && node.sourceCodeLocation) {
          const offset = node.sourceCodeLocation.startOffset;
          const raw = markup.slice(offset, node.sourceCodeLocation.endOffset);
          for (const match of raw.matchAll(/\{\{([^{}]+)\}\}/g)) {
            const value = templatePath(
              match[1]!.trim(),
              refs,
              stores,
              filename,
            );
            replacements.push({
              start: offset + match.index,
              end: offset + match.index + match[0].length,
              value: '{' + value + '}',
            });
          }
        }
        continue;
      }
      const start = node.sourceCodeLocation?.startTag?.startOffset;
      const originalTag =
        start === undefined
          ? ''
          : /^<\s*([A-Za-z][\w-]*)/.exec(markup.slice(start))?.[1];
      if (
        !originalTag ||
        /^[A-Z]/.test(originalTag) ||
        originalTag === 'slot' ||
        originalTag === 'component'
      )
        reject(filename, 'Vue component tag');
      for (const attribute of node.attrs) {
        const name = attribute.name;
        if (!name.startsWith(':') && !name.startsWith('@')) {
          if (
            name.startsWith('v-') ||
            name.startsWith('#') ||
            name === 'ref' ||
            name === 'key'
          )
            reject(filename, 'Vue directive');
          continue;
        }
        const target = name.slice(1);
        if (
          !/^[a-z][a-z0-9-]*$/.test(target) ||
          target === 'style' ||
          target === 'class' ||
          target === 'key' ||
          target === 'ref' ||
          !pathExpression.test(attribute.value)
        ) {
          reject(filename, 'Vue directive ' + name);
        }
        const root = attribute.value.split('.', 1)[0]!;
        if (name.startsWith('@') && (refs.has(root) || stores.has(root)))
          reject(filename, 'state used as event handler');
        const location = node.sourceCodeLocation?.attrs?.[name];
        if (!location) reject(filename, 'Vue directive ' + name);
        replacements.push({
          start: location.startOffset,
          end: location.endOffset,
          value:
            (name.startsWith('@') ? 'on:' : '') +
            target +
            '={' +
            (name.startsWith('@')
              ? attribute.value
              : templatePath(attribute.value, refs, stores, filename)) +
            '}',
        });
      }
      visit(
        node.tagName === 'template'
          ? (node as Html.Template).content.childNodes
          : node.childNodes,
      );
    }
  };
  visit(templateTree.childNodes);
  for (const replacement of replacements.sort(
    (left, right) => right.start - left.start,
  )) {
    markup =
      markup.slice(0, replacement.start) +
      replacement.value +
      markup.slice(replacement.end);
  }
  if (markup.includes('{{') || markup.includes('}}'))
    reject(filename, 'unparsed interpolation');
  let style = '';
  if (styles[0]) {
    const attrs = styles[0].attrs;
    if (attrs.length > 1 || (attrs.length === 1 && attrs[0]?.name !== 'scoped'))
      reject(filename, 'style attributes');
    style =
      '<style' +
      (attrs.length ? '' : ' global') +
      '>\n' +
      content(source, styles[0], filename) +
      '\n</style>\n';
  }
  return (
    (scriptContent
      ? '<script lang="ts">\n' + scriptContent + '\n</script>\n'
      : '') +
    markup +
    '\n' +
    style
  );
}
