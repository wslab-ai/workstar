import { isReadable, type Readable } from './reactivity.js';
import {
  assertAttributeName,
  normalizeAttributeValue,
} from './attribute-value.js';

// Keep template values interoperable when a bundler loads linked Workstar packages twice.
const templateBrand = Symbol.for('workstar.template.v1');
const directiveBrand = Symbol.for('workstar.directive.v1');
const repeatBrand = Symbol.for('workstar.repeat.v1');

export const slotPrefix = 'workstar-slot-';
export const directivePrefix = 'data-workstar-directive-';
export const arrayPrefix = 'workstar-array-';
export const repeatPrefix = 'workstar-repeat-';

export interface Repeat<T> {
  readonly [repeatBrand]: true;
  readonly source: Iterable<T> | Readable<Iterable<T>> | (() => Iterable<T>);
  readonly key: (item: T) => string | number;
  readonly view: (item: Readable<T>) => unknown;
}

export function repeat<T>(
  source: Iterable<T> | Readable<Iterable<T>> | (() => Iterable<T>),
  key: (item: T) => string | number,
  view: (item: Readable<T>) => unknown,
): Repeat<T> {
  return { [repeatBrand]: true, source, key, view };
}

export function isRepeat(value: unknown): value is Repeat<unknown> {
  return typeof value === 'object' && value !== null && repeatBrand in value;
}

export function repeatItems<T>(
  block: Repeat<T>,
): Array<{ key: string | number; item: T }> {
  const source = resolve(resolve(block.source));
  if (
    !source ||
    typeof (source as Iterable<T>)[Symbol.iterator] !== 'function'
  ) {
    throw new TypeError('A repeat source must be iterable.');
  }
  const seen = new Set<string | number>();
  return Array.from(source as Iterable<T>, (item) => {
    const key = block.key(item);
    if (
      (typeof key !== 'string' && typeof key !== 'number') ||
      (typeof key === 'number' && !Number.isFinite(key))
    ) {
      throw new TypeError('A repeat key must be a string or finite number.');
    }
    if (seen.has(key)) throw new Error(`Duplicate repeat key: ${String(key)}.`);
    seen.add(key);
    return { key, item };
  });
}

export interface Template {
  readonly [templateBrand]: true;
  readonly strings: TemplateStringsArray;
  readonly values: readonly unknown[];
}

export interface EventDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'event';
  readonly event: string;
  readonly listener: EventListenerOrEventListenerObject;
  readonly options?: EventListenerOptions | boolean;
}

export interface EventListenerOptions {
  readonly capture?: boolean;
  readonly once?: boolean;
  readonly passive?: boolean;
  readonly signal?: AbortSignal;
}

export interface AttributeDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'attribute';
  readonly name: string;
  readonly source: unknown;
}

export interface TextareaDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'textarea';
  readonly source: unknown;
}

export interface AttributesDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'attributes';
  readonly source: unknown;
}

export interface ElementRefDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'element-ref';
  readonly set: (element: Element | null) => void;
}

export type Directive =
  | EventDirective
  | AttributeDirective
  | TextareaDirective
  | AttributesDirective
  | ElementRefDirective;

export function isTemplate(value: unknown): value is Template {
  return typeof value === 'object' && value !== null && templateBrand in value;
}

export function isDirective(value: unknown): value is Directive {
  return typeof value === 'object' && value !== null && directiveBrand in value;
}

export function resolve(source: unknown): unknown {
  if (isReadable(source)) return source.value;
  if (typeof source === 'function') return (source as () => unknown)();
  return source;
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
  options?: EventListenerOptions | boolean,
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
  assertAttributeName(name);
  return { [directiveBrand]: true, kind: 'attribute', name, source };
}

export function attrs(source: unknown): AttributesDirective {
  return { [directiveBrand]: true, kind: 'attributes', source };
}

export function elementRef(
  set: (element: Element | null) => void,
): ElementRefDirective {
  return { [directiveBrand]: true, kind: 'element-ref', set };
}

export function spreadAttributes(source: unknown): Array<[string, string]> {
  const value = resolve(source);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError('Attribute spread must resolve to a plain record.');
  }
  const entries: Array<[string, string]> = [];
  for (const [name, attributeValue] of Object.entries(value)) {
    assertAttributeName(name);
    if (
      /^(?:style|children|ref|key|className|htmlFor|innerHTML)$/i.test(name) ||
      name.startsWith(directivePrefix)
    )
      throw new TypeError(`Unsupported spread attribute ${name}.`);
    const normalized = normalizeAttributeValue(
      name,
      attributeValue === false && /^(?:aria|data)-/i.test(name)
        ? 'false'
        : attributeValue,
    );
    if (normalized !== null) entries.push([name, normalized]);
  }
  return entries;
}

export function textareaValue(source: unknown): TextareaDirective {
  return { [directiveBrand]: true, kind: 'textarea', source };
}

export function resolveTextareaValue(source: unknown): string {
  const value = resolve(source);
  if (value === null || value === undefined || value === false) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  throw new TypeError('Textarea value must be text or a number.');
}
