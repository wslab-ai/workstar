import { ReactRoot } from './render.js';

/** React-compatible entry surface backed by Workstar's DOM and signals. */
export function createRoot(container: Element): ReactRoot {
  return new ReactRoot(container);
}

/** Hydrate Workstar-compatible TSX markup without replacing server DOM. */
export function hydrateRoot(container: Element, content: unknown): ReactRoot {
  const root = new ReactRoot(container, true);
  root.render(content);
  return root;
}
