import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

/** Resolve a local TSX component to an explicit opt-in compatibility import. */
export function resolveReactComponentImport(
  filename: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const candidate = specifier.endsWith('.tsx')
    ? specifier
    : extname(specifier) === ''
      ? `${specifier}.tsx`
      : undefined;
  if (!candidate || !existsSync(resolve(dirname(filename), candidate)))
    return undefined;
  return `${candidate}?workstar`;
}
