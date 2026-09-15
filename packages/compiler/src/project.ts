import { watch } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { compileComponentParts } from './index.js';
import { convertForeignComponent } from './compat.js';
import { reactComponentExportName } from './react-compat.js';
import { resolveReactComponentImport } from './react-import-resolution.js';

export interface ProjectStyles {
  cssOutputPath?: string;
}

export interface ForeignAuditEntry {
  filename: string;
  component: string;
  supported: boolean;
  reason?: string;
  suggestion?: string;
}

export interface ForeignDependency {
  package: string;
  files: string[];
  handling: 'workstar-runtime-alias' | 'requires-browser-verification';
}

export interface ForeignAudit {
  total: number;
  supported: number;
  entries: ForeignAuditEntry[];
  dependencies: ForeignDependency[];
}

function componentName(source: string, filename: string): string {
  const match =
    /export\s+default\s+function\s+([A-Za-z_$][\w$]*)/.exec(source) ??
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(source) ??
    /export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(source);
  return (
    match?.[1] ??
    filename
      .split(/[\\/]/)
      .at(-1)!
      .replace(/\.[^.]+$/, '')
  );
}

function packageName(specifier: string): string | undefined {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#')
  )
    return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function sourcePackages(source: string): string[] {
  const packages = new Set<string>();
  for (const match of source.matchAll(
    /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g,
  )) {
    const name = packageName(match[1] ?? '');
    if (name) packages.add(name);
  }
  return [...packages];
}

async function filesInDirectory(
  directory: string,
  include: (filename: string) => boolean,
  prefix = '',
): Promise<string[]> {
  const entries = await readdir(join(directory, prefix), {
    withFileTypes: true,
  });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = join(prefix, entry.name);
      if (entry.isDirectory())
        return filesInDirectory(directory, include, path);
      return entry.isFile() && include(entry.name) ? [path] : [];
    }),
  );
  return paths.flat().sort();
}

function generatedPath(viewPath: string): string {
  return `${viewPath.slice(0, -'.workstar'.length)}.ts`;
}

function relocatedImport(
  sourcePath: string,
  outputPath: string,
  specifier: string,
): string {
  if (specifier.endsWith('.tsx?workstar')) {
    const sourceTarget = resolve(
      dirname(sourcePath),
      specifier.slice(0, -'?workstar'.length),
    );
    const generatedTarget = resolve(
      dirname(outputPath),
      relative(dirname(sourcePath), sourceTarget).slice(0, -'.tsx'.length),
    );
    const path = relative(dirname(outputPath), generatedTarget)
      .split(sep)
      .join('/');
    return path.startsWith('.') ? path : `./${path}`;
  }
  const target = resolve(dirname(sourcePath), specifier);
  const path = relative(dirname(outputPath), target).split(sep).join('/');
  return path.startsWith('.') ? path : `./${path}`;
}

async function compileSourceFile(
  sourcePath: string,
  outputPath: string,
  source: string,
  options: ProjectStyles,
  namedExport?: string,
): Promise<void> {
  const { code, css } = compileComponentParts(source, sourcePath, {
    rewriteRelativeImport: (specifier) =>
      relocatedImport(sourcePath, outputPath, specifier),
  });
  if (css && !options.cssOutputPath) {
    throw new Error(
      `${sourcePath}: pass cssOutputPath to emit component styles.`,
    );
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    code + (namedExport ? `\nexport { render as ${namedExport} };\n` : ''),
    'utf8',
  );
  if (options.cssOutputPath) {
    await mkdir(dirname(options.cssOutputPath), { recursive: true });
    await writeFile(options.cssOutputPath, css, 'utf8');
  }
}

/** Compile one authored Workstar view without rewriting unrelated generated modules. */
export async function compileViewFile(
  sourcePath: string,
  outputPath: string,
  options: ProjectStyles = {},
): Promise<void> {
  await compileSourceFile(
    sourcePath,
    outputPath,
    await readFile(sourcePath, 'utf8'),
    options,
  );
}

/** Compile a supported TSX or Vue SFC through the Workstar runtime. */
export async function compileForeignFile(
  sourcePath: string,
  outputPath: string,
  options: ProjectStyles = {},
): Promise<void> {
  const original = await readFile(sourcePath, 'utf8');
  const source = convertForeignComponent(original, sourcePath, {
    resolveReactImport: (specifier) =>
      resolveReactComponentImport(sourcePath, specifier),
  });
  const namedExport = sourcePath.endsWith('.tsx')
    ? reactComponentExportName(original, sourcePath)
    : undefined;
  await compileSourceFile(sourcePath, outputPath, source, options, namedExport);
}

/** Report source compatibility without writing generated files or changing the app. */
export async function auditForeignDirectory(
  sourceDirectory: string,
): Promise<ForeignAudit> {
  const paths = await filesInDirectory(
    sourceDirectory,
    (name) =>
      /\.(tsx|vue)$/.test(name) &&
      !/\.(test|spec|stories)\.(tsx|vue)$/.test(name),
  );
  const dependencyFiles = new Map<string, Set<string>>();
  const entries = await Promise.all(
    paths.map(async (filename): Promise<ForeignAuditEntry> => {
      const sourcePath = join(sourceDirectory, filename);
      const source = await readFile(sourcePath, 'utf8');
      for (const dependency of sourcePackages(source)) {
        const files = dependencyFiles.get(dependency) ?? new Set<string>();
        files.add(filename);
        dependencyFiles.set(dependency, files);
      }
      const component = componentName(source, filename);
      try {
        const converted = convertForeignComponent(source, sourcePath, {
          resolveReactImport: (specifier) =>
            resolveReactComponentImport(sourcePath, specifier),
        });
        compileComponentParts(converted, `${sourcePath}.workstar`);
        return { filename, component, supported: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          filename,
          component,
          supported: false,
          reason: message.replace(sourcePath, filename),
          suggestion:
            'Use Workstar runtime compatibility for stateful or third-party components, or simplify this component for source compilation.',
        };
      }
    }),
  );
  return {
    total: entries.length,
    supported: entries.filter((entry) => entry.supported).length,
    entries,
    dependencies: [...dependencyFiles]
      .map(([name, files]): ForeignDependency => ({
        package: name,
        files: [...files].sort(),
        handling:
          /^(?:react|react-dom|react-router|react-router-dom|vue)$/.test(name)
            ? 'workstar-runtime-alias'
            : 'requires-browser-verification',
      }))
      .sort((left, right) => left.package.localeCompare(right.package)),
  };
}

/** Compile every view before writing any generated modules. */
export async function compileViewDirectory(
  sourceDirectory: string,
  outputDirectory: string,
  options: ProjectStyles = {},
): Promise<string[]> {
  const viewPaths = await filesInDirectory(sourceDirectory, (name) =>
    name.endsWith('.workstar'),
  );
  if (viewPaths.length === 0) {
    throw new Error(`No .workstar views found in ${sourceDirectory}.`);
  }

  const modules = await Promise.all(
    viewPaths.map(async (viewPath) => {
      const sourcePath = join(sourceDirectory, viewPath);
      const outputPath = join(outputDirectory, generatedPath(viewPath));
      const source = await readFile(sourcePath, 'utf8');
      const { code, css } = compileComponentParts(source, sourcePath, {
        rewriteRelativeImport: (specifier) =>
          relocatedImport(sourcePath, outputPath, specifier),
      });
      return {
        filename: generatedPath(viewPath),
        code,
        css,
      };
    }),
  );

  if (modules.some(({ css }) => css) && !options.cssOutputPath) {
    throw new Error('Pass cssOutputPath to emit component styles.');
  }

  await mkdir(outputDirectory, { recursive: true });
  const current = new Set(modules.map(({ filename }) => filename));
  for (const path of await filesInDirectory(outputDirectory, (name) =>
    name.endsWith('.ts'),
  )) {
    if (current.has(path)) continue;
    const stalePath = join(outputDirectory, path);
    if (
      (await readFile(stalePath, 'utf8')).startsWith(
        '// Generated by workstar-compiler.',
      )
    ) {
      await rm(stalePath);
    }
  }
  await Promise.all(
    modules.map(async ({ filename, code }) => {
      const outputPath = join(outputDirectory, filename);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, code, 'utf8');
    }),
  );
  if (options.cssOutputPath) {
    const stylesheet = modules
      .filter(({ css }) => css)
      .map(({ filename, css }) => `/* ${filename} */\n${css}`)
      .join('\n');
    await mkdir(dirname(options.cssOutputPath), { recursive: true });
    await writeFile(options.cssOutputPath, stylesheet, 'utf8');
  }
  return modules.map(({ filename }) => filename);
}

/** Watch a view directory and recompile changed views for local development. */
export async function watchViewDirectory(
  sourceDirectory: string,
  outputDirectory: string,
  onError: (error: unknown) => void,
  options: ProjectStyles = {},
): Promise<() => void> {
  await compileViewDirectory(sourceDirectory, outputDirectory, options);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let compiling = false;
  let pending = false;

  async function recompile(): Promise<void> {
    if (compiling) {
      pending = true;
      return;
    }
    compiling = true;
    do {
      pending = false;
      try {
        await compileViewDirectory(sourceDirectory, outputDirectory, options);
      } catch (error) {
        onError(error);
      }
    } while (pending);
    compiling = false;
  }

  const watcher = watch(
    sourceDirectory,
    { recursive: true },
    (_event, filename) => {
      if (filename && !filename.endsWith('.workstar')) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void recompile(), 60);
    },
  );
  return () => {
    if (debounce) clearTimeout(debounce);
    watcher.close();
  };
}
