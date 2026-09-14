import { ReactRoot } from './render.js';

/** React-compatible entry surface backed by Workstar's DOM and signals. */
export function createRoot(container: Element): ReactRoot {
  return new ReactRoot(container);
}
