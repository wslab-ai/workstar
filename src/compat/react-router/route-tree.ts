import { createRouter } from 'workstar-router';
import { isElement } from '../react/vnode.js';

export interface RouteBranch {
  readonly elements: readonly unknown[];
  readonly params: Readonly<Record<string, string>>;
}

interface RouteEntry {
  readonly name: string;
  readonly path: string;
  readonly elements: readonly unknown[];
}

export function Route(): never {
  throw new Error('Route elements must be children of Routes.');
}

function routeChildren(value: unknown): Array<ReturnType<typeof getRoute>> {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value)) return value.flatMap(routeChildren);
  return [getRoute(value)];
}

function getRoute(value: unknown) {
  if (!isElement(value) || value.type !== Route)
    throw new TypeError('Routes accepts only Route children.');
  return value;
}

function joinPath(parent: string, child: string | undefined): string {
  if (!child) return parent;
  if (child.startsWith('/')) return child;
  return `${parent.replace(/\/$/, '')}/${child}`;
}

function collect(
  routes: readonly ReturnType<typeof getRoute>[],
  parentPath: string,
  ancestors: readonly unknown[],
  leaves: RouteEntry[],
): void {
  for (const route of routes) {
    const { path, index, element, children } = route.props;
    if (path !== undefined && typeof path !== 'string')
      throw new TypeError('Route path must be a string.');
    if (index && path !== undefined)
      throw new TypeError('Index routes cannot have a path.');
    const fullPath = joinPath(parentPath, path as string | undefined);
    const branch = element === undefined ? ancestors : [...ancestors, element];
    const nested = routeChildren(children);
    if (nested.length > 0) {
      if (index) throw new TypeError('Index routes cannot have children.');
      collect(nested, fullPath, branch, leaves);
    } else {
      leaves.push({
        name: `route-${leaves.length}`,
        path: fullPath || '/',
        elements: branch,
      });
    }
  }
}

export function matchRouteTree(
  children: unknown,
  pathname: string,
): RouteBranch | null {
  const leaves: RouteEntry[] = [];
  collect(routeChildren(children), '', [], leaves);
  const fallback = leaves.find(
    (entry) => entry.path === '/*' || entry.path === '*',
  );
  const ordinary = leaves.filter((entry) => entry !== fallback);
  const router = createRouter(
    ordinary.map((entry) => ({ name: entry.name, path: entry.path })),
  );
  const match = router.match(pathname);
  const selected = match
    ? ordinary.find((entry) => entry.name === match.name)
    : fallback;
  return selected
    ? { elements: selected.elements, params: match?.params ?? {} }
    : null;
}
