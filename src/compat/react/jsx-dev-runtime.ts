import { jsx, type Element, type ElementType } from './vnode.js';

export { Fragment } from './vnode.js';

export function jsxDEV(
  type: ElementType,
  props: Record<string, unknown> | null,
  key?: string | number,
  _isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): Element {
  return jsx(type, props, key);
}
