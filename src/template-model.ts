import { isReadable } from './reactivity.js';

const templateBrand = Symbol('workstar.template');
const directiveBrand = Symbol('workstar.directive');

export const slotPrefix = 'workstar-slot-';
export const directivePrefix = 'data-workstar-directive-';
export const arrayPrefix = 'workstar-array-';

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
  readonly options?: AddEventListenerOptions | boolean;
}

export interface AttributeDirective {
  readonly [directiveBrand]: true;
  readonly kind: 'attribute';
  readonly name: string;
  readonly source: unknown;
}

export type Directive = EventDirective | AttributeDirective;

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
