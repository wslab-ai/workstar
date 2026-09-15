import { readFile } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { ModuleNode, Plugin } from 'vite';
import { compileComponentParts } from './index.js';
import { convertForeignComponent } from './compat.js';
import { convertReactRootEntry } from './react-entry-compat.js';
import { reactComponentExportName } from './react-compat.js';
import { resolveReactComponentImport } from './react-import-resolution.js';
import { transpileComponent } from './source-map.js';
import { validateReactRuntimeSource } from './runtime-diagnostics.js';

export interface WorkstarPluginOptions {
  source?: string;
  /** Compile ordinary TSX/Vue imports within source, without ?workstar. */
  foreign?: 'explicit' | 'automatic' | 'runtime';
  /** Optional absolute runtime directory for isolated migration builds. */
  runtimeImportSource?: string;
}

/** Compile authored components as Vite modules without writing into src. */
export function workstar(options: WorkstarPluginOptions = {}): Plugin {
  let sourceDirectory: string;
  let development = false;
  const styleSuffix = '.css?workstar-style';
  const foreignPrefix = '\0workstar-foreign:';
  const foreignStylePrefix = '\0workstar-foreign-style:';
  const foreignStylePublic = 'virtual:workstar-foreign-style:';
  const foreignStyles = new Map<string, string>();
  const compiled = new Map<string, { code: string; css: string }>();

  function isAuthoredComponent(filename: string): boolean {
    const localPath = relative(sourceDirectory, filename);
    return (
      extname(localPath) === '.workstar' &&
      localPath !== '..' &&
      !localPath.startsWith(`..${sep}`) &&
      !isAbsolute(localPath)
    );
  }

  function isForeignSource(filename: string): boolean {
    const localPath = relative(sourceDirectory, filename);
    return (
      (filename.endsWith('.tsx') || filename.endsWith('.vue')) &&
      localPath !== '..' &&
      !localPath.startsWith(`..${sep}`) &&
      !isAbsolute(localPath)
    );
  }

  function rootComponents(modules: readonly ModuleNode[]): ModuleNode[] {
    const roots = new Set<ModuleNode>();
    const visited = new Set<ModuleNode>();

    function visit(module: ModuleNode): void {
      if (visited.has(module)) return;
      visited.add(module);
      const parents = [...module.importers].filter(
        (importer) =>
          importer.id && isAuthoredComponent(importer.id.split('?', 1)[0]!),
      );
      if (parents.length === 0) roots.add(module);
      else parents.forEach(visit);
    }

    modules.forEach(visit);
    return [...roots];
  }

  function compileForeignSource(source: string, filename: string) {
    const converted = convertForeignComponent(source, filename, {
      resolveReactImport: (specifier) =>
        resolveReactComponentImport(filename, specifier),
    });
    const namedExport = filename.endsWith('.tsx')
      ? reactComponentExportName(source, filename)
      : undefined;
    const generated = compileComponentParts(converted, `${filename}.workstar`, {
      cssImport: foreignStylePublic + encodeURIComponent(filename) + '.css',
    });
    foreignStyles.set(filename, generated.css);
    const output = transpileComponent(
      `${generated.code}\nexport { render as ${namedExport ?? 'default'} };\n`,
      converted,
      filename,
      generated.origins,
    );
    return { code: output.code, map: null };
  }

  return {
    name: 'workstar',
    enforce: 'pre',
    config() {
      if (options.foreign !== 'runtime') return;
      const runtime = options.runtimeImportSource ?? 'workstar/compat/react';
      const react = isAbsolute(runtime) ? `${runtime}/index.js` : runtime;
      const jsxRuntime = isAbsolute(runtime)
        ? `${runtime}/jsx-runtime.js`
        : `${runtime}/jsx-runtime`;
      const jsxDevRuntime = isAbsolute(runtime)
        ? `${runtime}/jsx-dev-runtime.js`
        : `${runtime}/jsx-dev-runtime`;
      const client = isAbsolute(runtime)
        ? `${runtime}/client.js`
        : `${runtime}/client`;
      const dom = isAbsolute(runtime) ? `${runtime}/dom.js` : `${runtime}/dom`;
      const server = isAbsolute(runtime)
        ? `${runtime}/server.js`
        : `${runtime}/server`;
      const router = isAbsolute(runtime)
        ? resolve(runtime, '../react-router/index.js')
        : 'workstar/compat/react-router';
      return {
        esbuild: {
          jsx: 'automatic',
          jsxImportSource: runtime,
        },
        resolve: {
          alias: [
            { find: /^react-router-dom$/, replacement: router },
            { find: /^react-router$/, replacement: router },
            { find: /^react-dom\/server$/, replacement: server },
            { find: /^react-dom\/client$/, replacement: client },
            { find: /^react-dom$/, replacement: dom },
            { find: /^react\/jsx-dev-runtime$/, replacement: jsxDevRuntime },
            { find: /^react\/jsx-runtime$/, replacement: jsxRuntime },
            { find: /^react$/, replacement: react },
          ],
        },
      };
    },
    configResolved(config) {
      sourceDirectory = resolve(config.root, options.source ?? 'src');
      development = config.command === 'serve';
    },
    resolveId(id, importer) {
      if (id.startsWith(foreignStylePublic)) {
        const encoded = id.slice(foreignStylePublic.length, -'.css'.length);
        return foreignStylePrefix + decodeURIComponent(encoded) + '.css';
      }
      if (id.endsWith('?workstar') && importer && id.startsWith('.')) {
        const importerPath = importer.startsWith(foreignPrefix)
          ? importer.slice(foreignPrefix.length)
          : importer.split('?', 1)[0]!;
        const filename = resolve(
          dirname(importerPath),
          id.slice(0, -'?workstar'.length),
        );
        return isForeignSource(filename) ? foreignPrefix + filename : null;
      }
      if (!id.endsWith(styleSuffix)) return null;
      const filename = id.slice(0, -styleSuffix.length);
      return isAuthoredComponent(filename) ? id : null;
    },
    async load(id) {
      if (id.startsWith(foreignStylePrefix)) {
        return (
          foreignStyles.get(
            id.slice(foreignStylePrefix.length, -'.css'.length),
          ) ?? null
        );
      }
      if (id.startsWith(foreignPrefix)) {
        const filename = id.slice(foreignPrefix.length);
        this.addWatchFile(filename);
        const source = await readFile(filename, 'utf8');
        return compileForeignSource(source, filename);
      }
      if (!id.endsWith(styleSuffix)) return null;
      const filename = id.slice(0, -styleSuffix.length);
      if (!isAuthoredComponent(filename)) return null;
      const source = await readFile(filename, 'utf8');
      return compileComponentParts(source, filename).css;
    },
    transform(source, id) {
      const filename = id.split('?', 1)[0]!;
      if (options.foreign === 'runtime' && /\.[cm]?[jt]sx?$/.test(filename))
        validateReactRuntimeSource(source, filename);
      if (options.foreign === 'automatic' && isForeignSource(filename)) {
        const entry = filename.endsWith('.tsx')
          ? convertReactRootEntry(source, filename)
          : undefined;
        if (entry) return { code: entry, map: null };
        return compileForeignSource(source, filename);
      }
      if (!isAuthoredComponent(filename)) return null;
      const generated = compileComponentParts(source, filename, {
        componentImports: 'source',
        cssImport: `${filename}${styleSuffix}`,
        hotState: development,
      });
      compiled.set(filename, generated);
      const output = transpileComponent(
        generated.code,
        source,
        filename,
        generated.origins,
      );
      return {
        code: output.code,
        map: JSON.stringify(output.map),
      };
    },
    async handleHotUpdate(context) {
      if (options.foreign !== 'runtime' && isForeignSource(context.file)) {
        const filename = context.file;
        const source = await context.read();
        const entry =
          options.foreign === 'automatic' && filename.endsWith('.tsx')
            ? convertReactRootEntry(source, filename)
            : undefined;
        if (!entry) {
          const converted = convertForeignComponent(source, filename, {
            resolveReactImport: (specifier) =>
              resolveReactComponentImport(filename, specifier),
          });
          const next = compileComponentParts(converted, `${filename}.workstar`);
          foreignStyles.set(filename, next.css);
        }
        const components = [
          context.server.moduleGraph.getModuleById(foreignPrefix + filename),
          options.foreign === 'automatic'
            ? context.server.moduleGraph.getModuleById(filename)
            : undefined,
        ].filter((module) => module !== undefined);
        const stylesheet = context.server.moduleGraph.getModuleById(
          foreignStylePrefix + filename + '.css',
        );
        components.forEach((module) =>
          context.server.moduleGraph.invalidateModule(module),
        );
        if (stylesheet) context.server.moduleGraph.invalidateModule(stylesheet);
        return [...components, stylesheet].filter(
          (module) => module !== undefined,
        );
      }
      if (!isAuthoredComponent(context.file)) return;
      const previous = compiled.get(context.file);
      const next = compileComponentParts(await context.read(), context.file, {
        componentImports: 'source',
        cssImport: `${context.file}${styleSuffix}`,
        hotState: development,
      });
      const stylesheet = context.server.moduleGraph.getModuleById(
        `${context.file}${styleSuffix}`,
      );
      if (!stylesheet) return;
      context.server.moduleGraph.invalidateModule(stylesheet);
      if (
        previous &&
        previous.code === next.code &&
        previous.css !== next.css
      ) {
        compiled.set(context.file, next);
        return [stylesheet];
      }
      const roots = rootComponents(context.modules);
      roots.forEach((module) =>
        context.server.moduleGraph.invalidateModule(module),
      );
      return [...roots, stylesheet];
    },
  };
}
