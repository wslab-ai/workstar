import { jsx, Portal } from './vnode.js';
import { flushReactiveUpdates } from '../../reactivity.js';
import { flushReactLayoutEffects } from './render.js';

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
  flushReactLayoutEffects();
  return result;
}

export default { createPortal, flushSync };
