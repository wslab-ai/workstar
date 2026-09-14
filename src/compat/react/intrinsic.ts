import {
  attr,
  elementRef,
  html,
  on,
  textareaValue,
  type Directive,
  type Template,
} from '../../template-model.js';

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
const unitlessStyles = new Set([
  'animationIterationCount',
  'borderImageOutset',
  'borderImageSlice',
  'borderImageWidth',
  'boxFlex',
  'flex',
  'flexGrow',
  'flexShrink',
  'fontWeight',
  'lineHeight',
  'opacity',
  'order',
  'orphans',
  'tabSize',
  'widows',
  'zIndex',
  'zoom',
]);

function styleText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('React style must be a plain object.');
  return Object.entries(value)
    .filter(
      ([, entry]) => entry !== null && entry !== undefined && entry !== '',
    )
    .map(([name, entry]) => {
      if (!/^--[a-zA-Z0-9_-]+$|^[a-zA-Z][a-zA-Z0-9]*$/.test(name))
        throw new TypeError(`Invalid style property ${name}.`);
      if (typeof entry !== 'string' && typeof entry !== 'number')
        throw new TypeError(`Invalid style value for ${name}.`);
      const property = name.startsWith('--')
        ? name
        : name.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      const suffix =
        typeof entry === 'number' &&
        entry !== 0 &&
        !unitlessStyles.has(name) &&
        !name.startsWith('--')
          ? 'px'
          : '';
      return `${property}:${entry}${suffix}`;
    })
    .join(';');
}

function eventName(
  name: string,
  tag: string,
  props: Readonly<Record<string, unknown>>,
): string {
  if (name === 'onDoubleClick') return 'dblclick';
  if (name === 'onChange') {
    return tag === 'input' &&
      !['checkbox', 'radio', 'file'].includes(String(props.type))
      ? 'input'
      : tag === 'textarea'
        ? 'input'
        : 'change';
  }
  return name.slice(2).toLowerCase();
}

function attributeName(name: string): string {
  if (name === 'className') return 'class';
  if (name === 'htmlFor') return 'for';
  if (name === 'tabIndex') return 'tabindex';
  if (name === 'autoFocus') return 'autofocus';
  return name;
}

function refDirective(value: unknown): Directive {
  if (typeof value === 'function')
    return elementRef(value as (element: Element | null) => void);
  if (value && typeof value === 'object' && 'current' in value) {
    return elementRef((element) => {
      (value as { current: Element | null }).current = element;
    });
  }
  throw new TypeError('React ref must be a callback or ref object.');
}

function svgImageSource(value: string): Directive {
  const match = /^data:image\/svg\+xml,([^#]*)$/i.exec(value);
  if (!match)
    throw new TypeError('Only encoded SVG data images are supported.');
  let markup: string;
  try {
    markup = decodeURIComponent(match[1] ?? '');
  } catch {
    throw new TypeError('Invalid SVG data image encoding.');
  }
  const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const allowedTags = new Set([
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
  ]);
  const allowedAttributes = new Set([
    'xmlns',
    'viewBox',
    'width',
    'height',
    'fill',
    'stroke',
    'stroke-width',
    'd',
    'transform',
    'cx',
    'cy',
    'r',
    'rx',
    'ry',
    'x',
    'y',
    'x1',
    'y1',
    'x2',
    'y2',
    'points',
    'opacity',
    'fill-rule',
    'clip-rule',
  ]);
  if (
    parsed.documentElement.localName !== 'svg' ||
    parsed.querySelector('parsererror') ||
    [...parsed.querySelectorAll('*')].some(
      (element) =>
        !allowedTags.has(element.localName) ||
        [...element.attributes].some(
          (attribute) =>
            !allowedAttributes.has(attribute.name) ||
            /(?:javascript:|data:|url\s*\()/i.test(attribute.value),
        ),
    )
  )
    throw new TypeError('Unsafe SVG data image.');
  return elementRef((element) => {
    if (element) {
      if (!(element instanceof HTMLImageElement))
        throw new TypeError('SVG data images require an img element.');
      element.src = value;
    }
  });
}

function propDirectives(
  tag: string,
  props: Readonly<Record<string, unknown>>,
): Directive[] {
  const directives: Directive[] = [];
  for (const [name, value] of Object.entries(props)) {
    if (
      name === 'children' ||
      name === 'key' ||
      value === undefined ||
      value === null
    )
      continue;
    if (name === 'dangerouslySetInnerHTML')
      throw new TypeError('dangerouslySetInnerHTML is not supported.');
    if (name === 'ref') {
      directives.push(refDirective(value));
      continue;
    }
    if (/^on[A-Z]/.test(name)) {
      if (typeof value !== 'function')
        throw new TypeError(`Event handler ${name} must be a function.`);
      directives.push(on(eventName(name, tag, props), value as EventListener));
      continue;
    }
    if (tag === 'textarea' && (name === 'value' || name === 'defaultValue')) {
      directives.push(textareaValue(value));
      continue;
    }
    if (
      tag === 'img' &&
      name === 'src' &&
      typeof value === 'string' &&
      value.startsWith('data:')
    ) {
      directives.push(svgImageSource(value));
      continue;
    }
    const mapped =
      name === 'defaultValue'
        ? 'value'
        : name === 'defaultChecked'
          ? 'checked'
          : attributeName(name);
    directives.push(
      attr(
        mapped,
        name === 'style'
          ? styleText(value)
          : typeof value === 'boolean' && /^(?:aria|data)-/.test(mapped)
            ? String(value)
            : value,
      ),
    );
  }
  return directives;
}

export function renderIntrinsic(
  tag: string,
  props: Readonly<Record<string, unknown>>,
  children: unknown,
): Template {
  if (!/^[a-z][a-z0-9-]*$/.test(tag))
    throw new TypeError(`Invalid intrinsic element ${tag}.`);
  const directives = propDirectives(tag, props);
  const strings = [`<${tag}`, ...directives.map(() => '')];
  const values: unknown[] = [...directives];
  if (voidTags.has(tag)) {
    if (children !== undefined && children !== null && children !== false)
      throw new TypeError(`Void element ${tag} cannot have children.`);
    strings[strings.length - 1] += '>';
  } else {
    strings[strings.length - 1] += '>';
    if (children === undefined || children === null || children === false) {
      strings[strings.length - 1] += `</${tag}>`;
    } else if (tag === 'textarea') {
      throw new TypeError('Textarea children are not supported; use value.');
    } else {
      values.push(children);
      strings.push(`</${tag}>`);
    }
  }
  return html(Object.assign(strings, { raw: [...strings] }), ...values);
}
