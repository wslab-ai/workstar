import { normalizeAttributeValue } from './attribute-value.js';
import { effect } from './reactivity.js';
import {
  arrayPrefix,
  directivePrefix,
  isDirective,
  isTemplate,
  resolve,
  slotPrefix,
  type Directive,
  type Template,
} from './template-model.js';

const activeMounts = new WeakMap<Element, () => void>();

class Scope {
  readonly #disposers: Array<() => void> = [];

  own(dispose: () => void): void {
    this.#disposers.push(dispose);
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0).reverse()) dispose();
  }
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
  hydrateInitial = false,
): void {
  let textNode: Text | undefined;
  let firstRun = hydrateInitial;
  scope.own(
    effect(() => {
      const value = resolve(source);
      if (firstRun) {
        firstRun = false;
        const hydratedScope = new Scope();
        try {
          hydrateValue(value, start, end, hydratedScope, document);
          textNode =
            start.nextSibling?.nodeType === Node.TEXT_NODE &&
            start.nextSibling.nextSibling === end
              ? (start.nextSibling as Text)
              : undefined;
        } catch (error) {
          hydratedScope.dispose();
          throw error;
        }
        return () => hydratedScope.dispose();
      }
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

function findEnd(start: Comment, prefix: string): Comment {
  const marker = start.data;
  if (!marker.startsWith(prefix)) throw new Error('Invalid hydration marker.');
  const ending = `/${marker}`;
  let depth = 0;
  for (
    let sibling = start.nextSibling;
    sibling;
    sibling = sibling.nextSibling
  ) {
    if (sibling.nodeType !== Node.COMMENT_NODE) continue;
    const comment = sibling as Comment;
    if (comment.data === marker) depth++;
    if (comment.data === ending) {
      if (depth === 0) return comment;
      depth--;
    }
  }
  throw new Error(`Missing hydration marker ${ending}.`);
}

function collectBindings(
  first: Node | null,
  stop: Node | null,
  slots: Map<number, [Comment, Comment]>,
  directives: Map<number, Element>,
): void {
  for (let node = first; node && node !== stop; node = node.nextSibling) {
    if (node.nodeType === Node.COMMENT_NODE) {
      const comment = node as Comment;
      if (comment.data.startsWith(slotPrefix)) {
        const index = Number(comment.data.slice(slotPrefix.length));
        if (!Number.isInteger(index) || slots.has(index))
          throw new Error('Invalid or duplicate hydration slot.');
        const end = findEnd(comment, slotPrefix);
        slots.set(index, [comment, end]);
        node = end;
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    for (const name of element.getAttributeNames()) {
      if (!name.startsWith(directivePrefix)) continue;
      const index = Number(name.slice(directivePrefix.length));
      if (!Number.isInteger(index) || directives.has(index))
        throw new Error('Invalid or duplicate hydration directive.');
      directives.set(index, element);
    }
    collectBindings(element.firstChild, null, slots, directives);
  }
}

function hydrateTemplate(
  template: Template,
  first: Node | null,
  stop: Node | null,
  scope: Scope,
  document: Document,
): void {
  const slots = new Map<number, [Comment, Comment]>();
  const directives = new Map<number, Element>();
  collectBindings(first, stop, slots, directives);
  const expectedSlots = template.values.filter((value) => !isDirective(value));
  const expectedDirectives = template.values.length - expectedSlots.length;
  if (
    slots.size !== expectedSlots.length ||
    directives.size !== expectedDirectives
  )
    throw new Error('Hydration markers do not match the template.');

  for (const [index, value] of template.values.entries()) {
    if (isDirective(value)) {
      const element = directives.get(index);
      if (!element) throw new Error(`Missing hydration directive ${index}.`);
      bindDirective(element, value, scope);
      element.removeAttribute(`${directivePrefix}${index}`);
    } else {
      const region = slots.get(index);
      if (!region) throw new Error(`Missing hydration slot ${index}.`);
      bindRegion(region[0], region[1], value, scope, document, true);
    }
  }
}

function hydrateValue(
  value: unknown,
  start: Comment,
  end: Comment,
  scope: Scope,
  document: Document,
): void {
  if (isTemplate(value)) {
    hydrateTemplate(value, start.nextSibling, end, scope, document);
    return;
  }
  if (Array.isArray(value)) {
    let cursor = start.nextSibling;
    for (const [index, child] of value.entries()) {
      if (
        cursor?.nodeType !== Node.COMMENT_NODE ||
        (cursor as Comment).data !== `${arrayPrefix}${index}`
      ) {
        throw new Error(`Missing hydration array item ${index}.`);
      }
      const itemStart = cursor as Comment;
      const itemEnd = findEnd(itemStart, arrayPrefix);
      hydrateValue(resolve(child), itemStart, itemEnd, scope, document);
      cursor = itemEnd.nextSibling;
    }
    if (cursor !== end) throw new Error('Hydration array length mismatch.');
    return;
  }
  if (value === null || value === undefined || value === false) {
    if (start.nextSibling !== end)
      throw new Error('Hydration content mismatch.');
    return;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    const expected = String(value);
    const node = start.nextSibling;
    if (expected === '' && node === end) return;
    if (
      node?.nodeType !== Node.TEXT_NODE ||
      node.nextSibling !== end ||
      (node as Text).data !== expected
    ) {
      throw new Error('Hydration text mismatch.');
    }
    return;
  }
  throw new TypeError('Unsupported hydration value.');
}

function setAttribute(element: Element, name: string, value: unknown): void {
  const text = normalizeAttributeValue(name, value);
  if (text === null) {
    element.removeAttribute(name);
    return;
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

export function hydrate(host: Element, content: unknown): () => void {
  if (activeMounts.has(host))
    throw new Error('Host already has an active Workstar view.');
  const start = host.firstChild;
  const end = host.lastChild;
  if (
    start?.nodeType !== Node.COMMENT_NODE ||
    (start as Comment).data !== 'workstar-root' ||
    end?.nodeType !== Node.COMMENT_NODE ||
    (end as Comment).data !== '/workstar-root'
  ) {
    throw new Error('Missing Workstar server-rendered root markers.');
  }
  const scope = new Scope();
  try {
    bindRegion(
      start as Comment,
      end as Comment,
      content,
      scope,
      host.ownerDocument,
      true,
    );
  } catch (error) {
    scope.dispose();
    throw error;
  }
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    activeMounts.delete(host);
    scope.dispose();
    host.replaceChildren();
  };
  activeMounts.set(host, dispose);
  return dispose;
}
