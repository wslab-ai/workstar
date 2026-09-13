import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface ComponentCompiler {
  compileComponentParts(source: string, filename: string): unknown;
}

interface SourcePosition {
  line: number;
  column: number;
}

export type ComponentCheck =
  | { status: 'valid' }
  | { status: 'unavailable'; message: string }
  | { status: 'invalid'; message: string; position?: SourcePosition }
  | { status: 'failed'; message: string };

const compilerCache = new Map<string, Promise<ComponentCompiler>>();

function packageEntry(packageJson: unknown): string {
  if (typeof packageJson !== 'object' || packageJson === null) {
    throw new Error('Invalid workstar-compiler package.json.');
  }
  const exports = 'exports' in packageJson ? packageJson.exports : undefined;
  const entry =
    typeof exports === 'object' && exports !== null && '.' in exports
      ? exports['.']
      : exports;
  const importPath =
    typeof entry === 'string'
      ? entry
      : typeof entry === 'object' && entry !== null && 'import' in entry
        ? entry.import
        : undefined;
  if (typeof importPath !== 'string' || !importPath.startsWith('./')) {
    throw new Error('The installed workstar-compiler has no ESM entry point.');
  }
  return importPath;
}

async function projectCompilerEntry(filename: string): Promise<string | null> {
  const modulePaths =
    createRequire(filename).resolve.paths('workstar-compiler') ?? [];
  for (const modulePath of modulePaths) {
    const packageRoot = join(modulePath, 'workstar-compiler');
    let manifest: string;
    try {
      manifest = await readFile(join(packageRoot, 'package.json'), 'utf8');
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'ENOENT' || error.code === 'ENOTDIR')
      ) {
        continue;
      }
      throw error;
    }
    return resolve(packageRoot, packageEntry(JSON.parse(manifest) as unknown));
  }
  return null;
}

function isCompiler(value: unknown): value is ComponentCompiler {
  return (
    typeof value === 'object' &&
    value !== null &&
    'compileComponentParts' in value &&
    typeof value.compileComponentParts === 'function'
  );
}

async function loadProjectCompiler(
  filename: string,
): Promise<ComponentCompiler | null> {
  const modulePath = await projectCompilerEntry(filename);
  if (!modulePath) return null;

  let compiler = compilerCache.get(modulePath);
  if (!compiler) {
    compiler = import(pathToFileURL(modulePath).href)
      .then((value: unknown) => {
        if (!isCompiler(value)) {
          throw new Error(
            'The installed workstar-compiler has no component compiler API.',
          );
        }
        return value;
      })
      .catch((error: unknown) => {
        compilerCache.delete(modulePath);
        throw error;
      });
    compilerCache.set(modulePath, compiler);
  }
  return compiler;
}

function sourcePosition(value: unknown): SourcePosition | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  if (!('line' in value) || !('column' in value)) return undefined;
  if (
    typeof value.line !== 'number' ||
    typeof value.column !== 'number' ||
    !Number.isInteger(value.line) ||
    !Number.isInteger(value.column) ||
    value.line < 1 ||
    value.column < 1
  ) {
    return undefined;
  }
  return { line: value.line, column: value.column };
}

/** Validate the unsaved editor text with the compiler installed in its project. */
export async function checkComponent(
  source: string,
  filename: string,
  loadCompiler: (
    filename: string,
  ) => Promise<ComponentCompiler | null> = loadProjectCompiler,
): Promise<ComponentCheck> {
  try {
    const compiler = await loadCompiler(filename);
    if (!compiler) {
      return {
        status: 'unavailable',
        message:
          'Install workstar-compiler in this project to enable .workstar diagnostics.',
      };
    }
    compiler.compileComponentParts(source, filename);
    return { status: 'valid' };
  } catch (error) {
    if (error instanceof Error && error.name === 'ComponentCompileError') {
      const detail = error as Error & {
        description?: unknown;
        position?: unknown;
      };
      const message =
        typeof detail.description === 'string'
          ? detail.description
          : error.message.replace(`${filename}: `, '');
      return {
        status: 'invalid',
        message,
        position: sourcePosition(detail.position),
      };
    }
    return {
      status: 'failed',
      message: `Workstar compiler could not run: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
