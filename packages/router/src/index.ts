export interface RouteDefinition<Name extends string = string> {
  readonly name: Name;
  readonly path: string;
  readonly validate?: Readonly<Record<string, (value: string) => boolean>>;
}

export interface RouteMatch<Name extends string = string> {
  readonly name: Name;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
}

type Segment =
  | { readonly kind: 'static'; readonly value: string }
  | {
      readonly kind: 'parameter';
      readonly name: string;
      readonly optional: boolean;
    }
  | { readonly kind: 'rest'; readonly name: string };

interface CompiledRoute<Name extends string> {
  readonly definition: RouteDefinition<Name>;
  readonly segments: readonly Segment[];
  readonly shape: string;
}

function splitPath(path: string, pattern = false): string[] {
  if (
    !path.startsWith('/') ||
    (!pattern && path.includes('?')) ||
    path.includes('#')
  ) {
    throw new TypeError('Route paths must be absolute pathnames.');
  }
  if (path === '/') return [];
  if (path.includes('//'))
    throw new TypeError('Route paths cannot contain empty segments.');
  return path.replace(/\/$/, '').slice(1).split('/');
}

function compile<Name extends string>(
  definition: RouteDefinition<Name>,
): CompiledRoute<Name> {
  const names = new Set<string>();
  const segments = splitPath(definition.path, true).map(
    (part, index, parts): Segment => {
      const parameter = /^:([A-Za-z][A-Za-z0-9_]*)(\?)?$/.exec(part);
      const rest = /^\*([A-Za-z][A-Za-z0-9_]*)$/.exec(part);
      if (parameter || rest) {
        const name = (parameter ?? rest)?.[1];
        if (!name || names.has(name))
          throw new TypeError('Duplicate or invalid route parameter.');
        names.add(name);
        if (rest) {
          if (index !== parts.length - 1)
            throw new TypeError('Rest parameter must be final.');
          return { kind: 'rest', name };
        }
        return { kind: 'parameter', name, optional: Boolean(parameter?.[2]) };
      }
      if (
        part.startsWith(':') ||
        part.startsWith('*') ||
        !/^[A-Za-z0-9._~-]+$/.test(part)
      ) {
        throw new TypeError(`Invalid static route segment: ${part}`);
      }
      return { kind: 'static', value: part };
    },
  );
  const shape = segments
    .map((segment) =>
      segment.kind === 'static'
        ? `s:${segment.value}`
        : segment.kind === 'rest'
          ? '*'
          : segment.optional
            ? ':?'
            : ':',
    )
    .join('/');
  for (const name of Object.keys(definition.validate ?? {})) {
    if (!names.has(name))
      throw new TypeError(`Unknown route validator ${name}.`);
  }
  return { definition, segments, shape };
}

function specificity(segment: Segment | undefined): number {
  if (!segment) return 2.5;
  if (segment.kind === 'static') return 4;
  if (segment.kind === 'rest') return 1;
  return segment.optional ? 2 : 3;
}

function compareRoutes<Name extends string>(
  left: CompiledRoute<Name>,
  right: CompiledRoute<Name>,
): number {
  const length = Math.max(left.segments.length, right.segments.length);
  for (let index = 0; index < length; index++) {
    const difference =
      specificity(right.segments[index]) - specificity(left.segments[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

function validParameters<Name extends string>(
  route: CompiledRoute<Name>,
  params: Readonly<Record<string, string>>,
): boolean {
  for (const [name, isValid] of Object.entries(
    route.definition.validate ?? {},
  )) {
    const value = params[name];
    if (value !== undefined && !isValid(value)) return false;
  }
  return true;
}

function decodePath(pathname: string): string[] | null {
  let parts: string[];
  try {
    parts = splitPath(pathname);
  } catch {
    return null;
  }
  try {
    return parts.map((part) => {
      const decoded = decodeURIComponent(part);
      if (
        decoded === '.' ||
        decoded === '..' ||
        /[\/\\\u0000-\u001f]/.test(decoded)
      ) {
        throw new TypeError('Unsafe pathname segment.');
      }
      return decoded;
    });
  } catch {
    return null;
  }
}

function matchSegments(
  pattern: readonly Segment[],
  pathname: readonly string[],
  patternIndex: number,
  pathIndex: number,
  params: Record<string, string>,
): Record<string, string> | null {
  if (patternIndex === pattern.length)
    return pathIndex === pathname.length ? params : null;
  const segment = pattern[patternIndex];
  if (!segment) return null;
  if (segment.kind === 'rest') {
    if (pathIndex === pathname.length) return null;
    return { ...params, [segment.name]: pathname.slice(pathIndex).join('/') };
  }
  const current = pathname[pathIndex];
  if (segment.kind === 'static') {
    return current === segment.value
      ? matchSegments(
          pattern,
          pathname,
          patternIndex + 1,
          pathIndex + 1,
          params,
        )
      : null;
  }
  if (current !== undefined) {
    const consumed = matchSegments(
      pattern,
      pathname,
      patternIndex + 1,
      pathIndex + 1,
      {
        ...params,
        [segment.name]: current,
      },
    );
    if (consumed) return consumed;
  }
  return segment.optional
    ? matchSegments(pattern, pathname, patternIndex + 1, pathIndex, params)
    : null;
}

function encodeParameter(value: string, name: string): string {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    /[\/\\\u0000-\u001f]/.test(value)
  ) {
    throw new TypeError(`Invalid value for route parameter ${name}.`);
  }
  return encodeURIComponent(value);
}

export function createRouter<const Name extends string>(
  definitions: readonly RouteDefinition<Name>[],
) {
  const routes = definitions.map(compile);
  const names = new Set<string>();
  const shapes = new Set<string>();
  for (const route of routes) {
    if (names.has(route.definition.name) || shapes.has(route.shape)) {
      throw new TypeError('Duplicate route name or path pattern.');
    }
    names.add(route.definition.name);
    shapes.add(route.shape);
  }
  const ranked = [...routes].sort(compareRoutes);

  return {
    match(pathname: string): RouteMatch<Name> | null {
      const parts = decodePath(pathname);
      if (!parts) return null;
      for (const route of ranked) {
        const params = matchSegments(route.segments, parts, 0, 0, {});
        if (params && validParameters(route, params)) {
          return {
            name: route.definition.name,
            path: route.definition.path,
            params: Object.freeze(params),
          };
        }
      }
      return null;
    },
    href(
      name: Name,
      params: Readonly<Record<string, string | undefined>> = {},
    ): string {
      const route = routes.find(
        (candidate) => candidate.definition.name === name,
      );
      if (!route) throw new TypeError(`Unknown route: ${name}`);
      const used = new Set<string>();
      const parts: string[] = [];
      for (const segment of route.segments) {
        if (segment.kind === 'static') {
          parts.push(segment.value);
          continue;
        }
        used.add(segment.name);
        const value = params[segment.name];
        if (
          value === undefined &&
          segment.kind === 'parameter' &&
          segment.optional
        )
          continue;
        if (value === undefined)
          throw new TypeError(`Missing route parameter ${segment.name}.`);
        if (segment.kind === 'rest') {
          parts.push(
            ...value
              .split('/')
              .map((part) => encodeParameter(part, segment.name)),
          );
        } else {
          parts.push(encodeParameter(value, segment.name));
        }
      }
      for (const key of Object.keys(params)) {
        if (!used.has(key))
          throw new TypeError(`Unexpected route parameter ${key}.`);
      }
      if (!validParameters(route, params as Readonly<Record<string, string>>)) {
        throw new TypeError('Route parameter failed validation.');
      }
      return parts.length ? `/${parts.join('/')}` : '/';
    },
  };
}
