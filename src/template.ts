import { effect, isReadable } from './reactivity.js';

const templateBrand = Symbol('workstar.template');
const directiveBrand = Symbol('workstar.directive');
const slotPrefix = 'workstar-slot-';
const directivePrefix = 'data-workstar-directive-';
const activeMounts = new WeakMap<Element, () => void>();

export interface Template {
  readonly [templateBrand]: true;
  readonly strings: TemplateStringsArray;
  readonly values: readonly unknown[];
}

interface EventDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'event';
  readonly event: string;
  readonly listener: EventListenerOrEventListenerObject;
  readonly options?: AddEventListenerOptions | boolean;
}

interface AttributeDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'attribute';
  readonly name: string;
  readonly source: unknown;
}

type Directive = EventDirective | AttributeDirective;

class Scope {
  readonly #disposers: Array<() => void> = [];

  own(dispose: () => void): void {
    this.#disposers.push(dispose);
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0).reverse()) dispose();
  }
}

function isTemplate(value: unknown): value is Template {
  return typeof value === 'object' && value !== null && templateBrand in value;
}

function isDirective(value: unknown): value is Directive {
  return typeof value === 'object' && value !== null && directiveBrand in value;
}

function resolve(source: unknown): unknown {
  if (isReadable(source)) return source.value;
  if (typeof source === 'function') return (source as () => unknown)();
  return source;
}

function render(value: unknown, document: Document, scope: Scope): Node {
  if (value === null || value === undefined || value === false) {
    return document.createDocumentFragment();
  }
  if (isTemplate(value)) return renderTemplate(value, document, scope);
  if (Array.isArray(value)) {
    const fragment = document.createDocumentFragment();
    for (const child of value) fragment.append(render(child, document, scope));
    return fragment;
  }
  if (value instanceof Node) return value;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return document.createTextNode(String(value));
  }
  throw new TypeError(
    'Unsupported template value. Use text, a DOM node, html, or an array.',
  );
}

function replaceBetween(start: Comment, end: Comment, next: Node): void {
  while (start.nextSibling && start.nextSibling !== end)
    start.nextSibling.remove();
  end.parentNode?.insertBefore(next, end);
}

function bindRegion(
  start: Comment,
  end: Comment,
  source: unknown,
  scope: Scope,
  document: Document,
): void {
  let textNode: Text | undefined;
  scope.own(
    effect(() => {
      const value = resolve(source);
      if (
        textNode &&
        start.nextSibling === textNode &&
        textNode.nextSibling === end &&
        (typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'bigint')
      ) {
        textNode.data = String(value);
        return;
      }
      const nextScope = new Scope();
      try {
        const next = render(value, document, nextScope);
        textNode =
          next.nodeType === Node.TEXT_NODE ? (next as Text) : undefined;
        replaceBetween(start, end, next);
      } catch (error) {
        nextScope.dispose();
        throw error;
      }
      return () => nextScope.dispose();
    }),
  );
}

function setAttribute(element: Element, name: string, value: unknown): void {
  if (value === null || value === undefined || value === false) {
    element.removeAttribute(name);
    return;
  }
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    throw new TypeError(
      `Attribute ${name} must resolve to a string, number, or boolean.`,
    );
  }
  const text = value === true ? '' : String(value);
  if (/^(href|src|action|formaction|xlink:href)$/i.test(name)) {
    let protocol: string;
    try {
      protocol = new URL(text, 'https://workstar.invalid').protocol;
    } catch {
      throw new TypeError(`Invalid URL for attribute ${name}.`);
    }
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(protocol)) {
      throw new TypeError(`Unsafe URL for attribute ${name}.`);
    }
  }
  element.setAttribute(name, text);
}

function bindDirective(
  element: Element,
  directive: Directive,
  scope: Scope,
): void {
  if (directive.kind === 'event') {
    element.addEventListener(
      directive.event,
      directive.listener,
      directive.options,
    );
    scope.own(() =>
      element.removeEventListener(
        directive.event,
        directive.listener,
        directive.options,
      ),
    );
    return;
  }
  scope.own(
    effect(() =>
      setAttribute(element, directive.name, resolve(directive.source)),
    ),
  );
}

function renderTemplate(
  template: Template,
  document: Document,
  scope: Scope,
): DocumentFragment {
  let markup = template.strings[0] ?? '';
  for (let index = 0; index < template.values.length; index++) {
    const marker = isDirective(template.values[index])
      ? ` ${directivePrefix}${index}=""`
      : `<!--${slotPrefix}${index}-->`;
    markup += marker + (template.strings[index + 1] ?? '');
  }

  const parsed = document.createElement('template');
  parsed.innerHTML = markup;
  const fragment = parsed.content;
  const slots = new Map<number, Comment>();
  const directives = new Map<number, Element>();

  const comments = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
  while (comments.nextNode()) {
    const comment = comments.currentNode as Comment;
    if (!comment.data.startsWith(slotPrefix)) continue;
    const index = Number(comment.data.slice(slotPrefix.length));
    if (Number.isInteger(index)) slots.set(index, comment);
  }

  const elements = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
  while (elements.nextNode()) {
    const element = elements.currentNode as Element;
    for (const name of element.getAttributeNames()) {
      if (!name.startsWith(directivePrefix)) continue;
      const index = Number(name.slice(directivePrefix.length));
      if (Number.isInteger(index)) directives.set(index, element);
      element.removeAttribute(name);
    }
  }

  for (const [index, value] of template.values.entries()) {
    if (isDirective(value)) {
      const element = directives.get(index);
      if (!element)
        throw new Error(
          'Directives must be placed inside an opening HTML tag.',
        );
      bindDirective(element, value, scope);
    } else {
      const start = slots.get(index);
      if (!start || !start.parentNode) {
        throw new Error(
          'Dynamic attributes require attr(). Child expressions belong in element content.',
        );
      }
      const end = document.createComment(`/${slotPrefix}${index}`);
      start.parentNode.insertBefore(end, start.nextSibling);
      bindRegion(start, end, value, scope, document);
    }
  }

  return fragment;
}

export function html(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Template {
  return { [templateBrand]: true, strings, values };
}

export function on(
  event: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
): EventDirective {
  if (!/^[a-z][a-z0-9:-]*$/i.test(event))
    throw new TypeError('Invalid event name.');
  return {
    [directiveBrand]: true,
    kind: 'event',
    event,
    listener,
    ...(options === undefined ? {} : { options }),
  };
}

export function attr(name: string, source: unknown): AttributeDirective {
  if (
    !/^[a-z_:][a-z0-9_:.\-]*$/i.test(name) ||
    /^on/i.test(name) ||
    /^srcdoc$/i.test(name)
  ) {
    throw new TypeError('Invalid or unsafe attribute name.');
  }
  return { [directiveBrand]: true, kind: 'attribute', name, source };
}

export function mount(host: Element, content: unknown): () => void {
  activeMounts.get(host)?.();
  const document = host.ownerDocument;
  const scope = new Scope();
  const start = document.createComment('workstar-root');
  const end = document.createComment('/workstar-root');
  host.replaceChildren(start, end);
  try {
    bindRegion(start, end, content, scope, document);
  } catch (error) {
    scope.dispose();
    host.replaceChildren();
    throw error;
  }
  let mounted = true;
  const dispose = () => {
    if (!mounted) return;
    mounted = false;
    activeMounts.delete(host);
    scope.dispose();
    host.replaceChildren();
  };
  activeMounts.set(host, dispose);
  return dispose;
}
