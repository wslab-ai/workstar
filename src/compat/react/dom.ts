import { jsx, Portal } from './vnode.js';
import { flushReactiveUpdates } from '../../reactivity.js';

export function createPortal(
  children: unknown,
  container: Element | DocumentFragment,
  key?: string,
) {
  return jsx(Portal, { children, container }, key);
}

export function flushSync<T>(callback: () => T): T {
  const result = callback();
  flushReactiveUpdates();
  return result;
}

export default { createPortal, flushSync };
