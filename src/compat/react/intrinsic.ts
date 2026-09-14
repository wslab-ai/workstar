import {
  attr,
  elementRef,
  html,
  on,
  textareaValue,
  type Directive,
  type ElementRefDirective,
  type Template,
} from '../../template-model.js';
import { effect, signal, type Writable } from '../../reactivity.js';

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

function svgImageSource(value: string): ElementRefDirective {
  if (
    /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(value)
  ) {
    return elementRef((element) => {
      if (element) {
        if (!(element instanceof HTMLImageElement))
          throw new TypeError('Image data requires an img element.');
        element.src = value;
      }
    });
  }
  const match = /^data:image\/svg\+xml(;base64)?,([^#]*)$/i.exec(value);
  if (!match) throw new TypeError('Unsupported data image source.');
  let markup: string;
  try {
    markup = match[1]
      ? new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(atob(match[2] ?? ''), (character) =>
            character.charCodeAt(0),
          ),
        )
      : decodeURIComponent(match[2] ?? '');
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

function assignRef(ref: unknown, element: Element | null): void {
  if (typeof ref === 'function') {
    (ref as (element: Element | null) => void)(element);
  } else if (ref && typeof ref === 'object' && 'current' in ref) {
    (ref as { current: Element | null }).current = element;
  } else {
    throw new TypeError('React ref must be a callback or ref object.');
  }
}

function controlledInput(
  name: 'value' | 'checked',
  source: Writable<unknown>,
): ElementRefDirective {
  let dispose: (() => void) | undefined;
  return elementRef((element) => {
    dispose?.();
    dispose = undefined;
    if (!(element instanceof HTMLInputElement)) return;
    dispose = effect(() => {
      const value = source.value;
      if (name === 'value') element.value = value == null ? '' : String(value);
      else element.checked = Boolean(value);
    });
  });
}

function propNames(props: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(props).filter(
    (name) =>
      name !== 'children' &&
      name !== 'key' &&
      name !== 'dangerouslySetInnerHTML' &&
      props[name] !== null &&
      props[name] !== undefined,
  );
}

function styleMarkup(
  tag: string,
  props: Readonly<Record<string, unknown>>,
  children: unknown,
): string | undefined {
  const markup = props.dangerouslySetInnerHTML;
  if (markup === undefined)
    return tag === 'style' && typeof children === 'string'
      ? children
      : undefined;
  if (
    tag !== 'style' ||
    (children !== undefined && children !== null && children !== false) ||
    !markup ||
    typeof markup !== 'object' ||
    !('__html' in markup) ||
    typeof markup.__html !== 'string'
  ) {
    throw new TypeError(
      'dangerouslySetInnerHTML is supported only for style text.',
    );
  }
  return markup.__html;
}

export interface IntrinsicView {
  readonly template: Template;
  matches(tag: string, props: Readonly<Record<string, unknown>>): boolean;
  update(props: Readonly<Record<string, unknown>>, children: unknown): void;
}

export function createIntrinsicView(
  tag: string,
  props: Readonly<Record<string, unknown>>,
  children: unknown,
): IntrinsicView {
  if (!/^[a-z][a-z0-9-]*$/.test(tag))
    throw new TypeError(`Invalid intrinsic element ${tag}.`);
  if (
    voidTags.has(tag) &&
    children !== undefined &&
    children !== null &&
    children !== false
  )
    throw new TypeError(`Void element ${tag} cannot have children.`);
  if (
    tag === 'textarea' &&
    children !== undefined &&
    children !== null &&
    children !== false
  )
    throw new TypeError('Textarea children are not supported; use value.');

  const names = propNames(props);
  const sources = new Map<string, Writable<unknown>>();
  const initialStyleMarkup = styleMarkup(tag, props, children);
  const childSource = signal(
    initialStyleMarkup === undefined ? children : null,
  );
  let currentProps = props;
  let currentChildren = children;
  let refElement: Element | null = null;
  let imageElement: Element | null = null;
  let styleElement: Element | null = null;
  const directives: Directive[] = [];
  if (initialStyleMarkup !== undefined) {
    directives.push(
      elementRef((element) => {
        styleElement = element;
        if (element)
          element.textContent =
            styleMarkup(tag, currentProps, currentChildren) ?? '';
      }),
    );
  }
  for (const name of names) {
    const value = props[name];
    if (name === 'ref') {
      if (
        typeof value !== 'function' &&
        !(value && typeof value === 'object' && 'current' in value)
      )
        throw new TypeError('React ref must be a callback or ref object.');
      directives.push(
        elementRef((element) => {
          refElement = element;
          assignRef(currentProps.ref, element);
        }),
      );
      continue;
    }
    if (/^on[A-Z]/.test(name)) {
      if (typeof value !== 'function')
        throw new TypeError(`Event handler ${name} must be a function.`);
      directives.push(
        on(eventName(name, tag, props), (event) => {
          (currentProps[name] as EventListener)(event);
        }),
      );
      continue;
    }
    const source = signal(value);
    sources.set(name, source);
    if (tag === 'textarea' && (name === 'value' || name === 'defaultValue')) {
      directives.push(textareaValue(source));
      continue;
    }
    if (
      tag === 'img' &&
      name === 'src' &&
      typeof value === 'string' &&
      value.startsWith('data:')
    ) {
      svgImageSource(value);
      directives.push(
        elementRef((element) => {
          imageElement = element;
          if (element) svgImageSource(String(currentProps.src)).set(element);
        }),
      );
      continue;
    }
    const mapped =
      name === 'defaultValue'
        ? 'value'
        : name === 'defaultChecked'
          ? 'checked'
          : attributeName(name);
    directives.push(
      attr(mapped, () => {
        const current = source.value;
        return name === 'style'
          ? styleText(current)
          : typeof current === 'boolean' && /^(?:aria|data)-/.test(mapped)
            ? String(current)
            : current;
      }),
    );
    if (tag === 'input' && (name === 'value' || name === 'checked'))
      directives.push(controlledInput(name, source));
  }
  const strings = [`<${tag}`, ...directives.map(() => '')];
  const values: unknown[] = [...directives];
  if (voidTags.has(tag)) {
    strings[strings.length - 1] += '>';
  } else {
    strings[strings.length - 1] += '>';
    if (tag === 'textarea' || initialStyleMarkup !== undefined) {
      strings[strings.length - 1] += `</${tag}>`;
    } else {
      values.push(childSource);
      strings.push(`</${tag}>`);
    }
  }
  const template = html(
    Object.assign(strings, { raw: [...strings] }),
    ...values,
  );
  return {
    template,
    matches(nextTag, nextProps) {
      const nextNames = propNames(nextProps);
      return (
        nextTag === tag &&
        names.length === nextNames.length &&
        names.every(
          (name, index) =>
            name === nextNames[index] &&
            (!/^on[A-Z]/.test(name) ||
              eventName(name, tag, props) === eventName(name, tag, nextProps)),
        ) &&
        Boolean(props.dangerouslySetInnerHTML !== undefined) ===
          Boolean(nextProps.dangerouslySetInnerHTML !== undefined) &&
        (tag !== 'img' ||
          !names.includes('src') ||
          String(props.src).startsWith('data:') ===
            String(nextProps.src).startsWith('data:'))
      );
    },
    update(nextProps, nextChildren) {
      const previousProps = currentProps;
      for (const name of names) {
        if (/^on[A-Z]/.test(name) && typeof nextProps[name] !== 'function')
          throw new TypeError(`Event handler ${name} must be a function.`);
        if (name === 'style') styleText(nextProps[name]);
      }
      if (refElement && previousProps.ref !== nextProps.ref) {
        assignRef(previousProps.ref, null);
        assignRef(nextProps.ref, refElement);
      }
      currentProps = nextProps;
      currentChildren = nextChildren;
      for (const [name, source] of sources) {
        if (
          name === 'src' &&
          imageElement &&
          !Object.is(previousProps.src, nextProps.src)
        )
          svgImageSource(String(nextProps[name])).set(imageElement);
        source.value = nextProps[name];
      }
      const nextStyleMarkup = styleMarkup(tag, nextProps, nextChildren);
      if (styleElement) styleElement.textContent = nextStyleMarkup ?? '';
      childSource.value = nextStyleMarkup === undefined ? nextChildren : null;
    },
  };
}
