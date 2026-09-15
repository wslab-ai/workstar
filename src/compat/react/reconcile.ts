import type { Context, Element as ReactElement } from './vnode.js';

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

export function childPath(
  parent: string,
  child: ReactElement,
  index: number,
): string {
  return `${parent}/${child.key === null ? index : `key:${String(child.key)}`}`;
}

export function sameProps(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(previous);
  return (
    keys.length === Object.keys(next).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(next, key) &&
        Object.is(previous[key], next[key]),
    )
  );
}

export function sameContext(
  previous: ReadonlyMap<Context<unknown>, unknown>,
  next: ReadonlyMap<Context<unknown>, unknown>,
): boolean {
  return (
    previous.size === next.size &&
    [...previous].every(
      ([key, value]) => next.has(key) && Object.is(value, next.get(key)),
    )
  );
}
