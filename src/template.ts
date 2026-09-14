import { normalizeAttributeValue } from './attribute-value.js';
import { effect, signal, type Writable } from './reactivity.js';
import {
  arrayPrefix,
  directivePrefix,
  isDirective,
  isRepeat,
  isTemplate,
  repeatItems,
  repeatPrefix,
  resolve,
  resolveTextareaValue,
  slotPrefix,
  spreadAttributes,
  type Directive,
  type Repeat,
  type Template,
} from './template-model.js';

const activeMounts = new WeakMap<Element, () => void>();
const svgNamespace = 'http://www.w3.org/2000/svg';

function renderParent(node: Node | null, fallback?: Node | null): Node | null {
  return node?.nodeType === Node.ELEMENT_NODE ? node : (fallback ?? node);
}

class Scope {
  readonly #disposers: Array<() => void> = [];

  own(dispose: () => void): void {
    this.#disposers.push(dispose);
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0).reverse()) dispose();
  }
}

function render(
  value: unknown,
  document: Document,
  scope: Scope,
  parent?: Node | null,
): Node {
  if (value === null || value === undefined || value === false) {
    return document.createDocumentFragment();
  }
  if (isRepeat(value)) {
    const fragment = document.createDocumentFragment();
    const start = document.createComment('workstar-repeat');
    const end = document.createComment('/workstar-repeat');
    fragment.append(start, end);
    bindRepeat(start, end, value, scope, document, false, parent);
    return fragment;
  }
  if (isTemplate(value)) return renderTemplate(value, document, scope, parent);
  if (Array.isArray(value)) {
    const fragment = document.createDocumentFragment();
    for (const child of value)
      fragment.append(render(child, document, scope, parent));
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
  parent?: Node | null,
): void {
  if (isRepeat(source)) {
    bindRepeat(
      start,
      end,
      source,
      scope,
      document,
      hydrateInitial,
      renderParent(start.parentNode, parent),
    );
    return;
  }
  let textNode: Text | undefined;
  let firstRun = hydrateInitial;
  let currentScope: Scope | undefined;
  let currentValue: unknown;
  let hasValue = false;
  scope.own(() => currentScope?.dispose());
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
        currentScope = hydratedScope;
        currentValue = value;
        hasValue = true;
        return;
      }
      if (hasValue && Object.is(currentValue, value)) return;
      if (
        textNode &&
        start.nextSibling === textNode &&
        textNode.nextSibling === end &&
        (typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'bigint')
      ) {
        textNode.data = String(value);
        currentValue = value;
        hasValue = true;
        return;
      }
      const nextScope = new Scope();
      try {
        const next = render(
          value,
          document,
          nextScope,
          renderParent(start.parentNode, parent),
        );
        textNode =
          next.nodeType === Node.TEXT_NODE ? (next as Text) : undefined;
        currentScope?.dispose();
        replaceBetween(start, end, next);
      } catch (error) {
        nextScope.dispose();
        throw error;
      }
      currentScope = nextScope;
      currentValue = value;
      hasValue = true;
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

interface RepeatEntry {
  readonly start: Comment;
  readonly end: Comment;
  readonly scope: Scope;
  readonly item: Writable<unknown>;
}

function moveInclusive(entry: RepeatEntry, before: Node): void {
  if (entry.end.nextSibling === before) return;
  const fragment = entry.start.ownerDocument.createDocumentFragment();
  for (let node: Node | null = entry.start; node;) {
    const next: Node | null = node.nextSibling;
    fragment.appendChild(node);
    if (node === entry.end) break;
    node = next;
  }
  before.parentNode?.insertBefore(fragment, before);
}

function removeInclusive(entry: RepeatEntry): void {
  entry.scope.dispose();
  for (let node: Node | null = entry.start; node;) {
    const next: Node | null = node.nextSibling;
    node.parentNode?.removeChild(node);
    if (node === entry.end) break;
    node = next;
  }
}

function bindRepeat(
  start: Comment,
  end: Comment,
  block: Repeat<unknown>,
  scope: Scope,
  document: Document,
  hydrateInitial = false,
  parent?: Node | null,
): void {
  let entries = new Map<string | number, RepeatEntry>();
  scope.own(() => {
    for (const entry of entries.values()) entry.scope.dispose();
    entries.clear();
  });
  let hydrating = hydrateInitial;
  scope.own(
    effect(() => {
      const items = repeatItems(block);
      if (hydrating) {
        hydrating = false;
        let cursor = start.nextSibling;
        const hydrated = new Map<string | number, RepeatEntry>();
        entries = hydrated;
        for (const [index, { key, item }] of items.entries()) {
          if (
            cursor?.nodeType !== Node.COMMENT_NODE ||
            (cursor as Comment).data !== `${repeatPrefix}${index}`
          ) {
            throw new Error(`Missing hydration repeat item ${index}.`);
          }
          const itemStart = cursor as Comment;
          const itemEnd = findEnd(itemStart, repeatPrefix);
          const itemScope = new Scope();
          const itemSignal = signal(item);
          hydrated.set(key, {
            start: itemStart,
            end: itemEnd,
            scope: itemScope,
            item: itemSignal,
          });
          bindRegion(
            itemStart,
            itemEnd,
            block.view(itemSignal),
            itemScope,
            document,
            true,
            renderParent(start.parentNode, parent),
          );
          cursor = itemEnd.nextSibling;
        }
        if (cursor !== end)
          throw new Error('Hydration repeat length mismatch.');
        return;
      }

      const next = new Map<string | number, RepeatEntry>();
      try {
        for (const { key, item } of items) {
          const existing = entries.get(key);
          if (existing) {
            existing.item.value = item;
            next.set(key, existing);
            continue;
          }
          const itemScope = new Scope();
          const itemSignal = signal(item);
          const itemStart = document.createComment(
            `${repeatPrefix}${next.size}`,
          );
          const itemEnd = document.createComment(
            `/${repeatPrefix}${next.size}`,
          );
          const fragment = document.createDocumentFragment();
          fragment.append(itemStart, itemEnd);
          const created: RepeatEntry = {
            start: itemStart,
            end: itemEnd,
            scope: itemScope,
            item: itemSignal,
          };
          next.set(key, created);
          bindRegion(
            itemStart,
            itemEnd,
            block.view(itemSignal),
            itemScope,
            document,
            false,
            renderParent(start.parentNode, parent),
          );
          end.parentNode?.insertBefore(fragment, end);
        }
        for (const [key, entry] of entries) {
          if (!next.has(key)) removeInclusive(entry);
        }
        let before: Node = end;
        for (const entry of [...next.values()].reverse()) {
          moveInclusive(entry, before);
          before = entry.start;
        }
        entries = next;
      } catch (error) {
        for (const [key, entry] of next) {
          if (!entries.has(key)) removeInclusive(entry);
        }
        throw error;
      }
    }),
  );
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
      bindDirective(element, value, scope, true);
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
  if (isRepeat(value)) {
    bindRepeat(start, end, value, scope, document, true);
    return;
  }
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
  hydrating = false,
): void {
  if (directive.kind === 'element-ref') {
    directive.set(element);
    scope.own(() => directive.set(null));
    return;
  }
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
  if (directive.kind === 'textarea') {
    if (!(element instanceof HTMLTextAreaElement)) {
      throw new TypeError(
        'Textarea value directive requires a textarea element.',
      );
    }
    let initial = true;
    scope.own(
      effect(() => {
        const text = resolveTextareaValue(directive.source);
        if (initial && hydrating) {
          if (element.defaultValue !== text) {
            throw new Error('Hydration textarea value mismatch.');
          }
          if (element.value !== element.defaultValue) {
            initial = false;
            return;
          }
        }
        element.value = text;
        initial = false;
      }),
    );
    return;
  }
  if (directive.kind === 'attributes') {
    let previous = new Set<string>();
    scope.own(
      effect(() => {
        const entries = spreadAttributes(directive.source);
        const next = new Set(entries.map(([name]) => name));
        for (const name of previous) {
          if (!next.has(name)) element.removeAttribute(name);
        }
        for (const [name, value] of entries) element.setAttribute(name, value);
        previous = next;
      }),
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
  parent?: Node | null,
): DocumentFragment {
  let markup = template.strings[0] ?? '';
  for (let index = 0; index < template.values.length; index++) {
    const marker = isDirective(template.values[index])
      ? ` ${directivePrefix}${index}=""`
      : `<!--${slotPrefix}${index}-->`;
    markup += marker + (template.strings[index + 1] ?? '');
  }

  const parsed = document.createElement('template');
  if (
    parent instanceof Element &&
    parent.namespaceURI === svgNamespace &&
    parent.localName !== 'foreignObject'
  ) {
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.innerHTML = markup;
    parsed.content.append(...svg.childNodes);
  } else {
    parsed.innerHTML = markup;
  }
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
