import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { ModuleNode, Plugin } from 'vite';
import { compileComponentParts } from './index.js';
import { transpileComponent } from './source-map.js';

export interface WorkstarPluginOptions {
  source?: string;
}

/** Compile authored components as Vite modules without writing into src. */
export function workstar(options: WorkstarPluginOptions = {}): Plugin {
  let sourceDirectory: string;
  let development = false;
  const styleSuffix = '.css?workstar-style';
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

  return {
    name: 'workstar',
    enforce: 'pre',
    configResolved(config) {
      sourceDirectory = resolve(config.root, options.source ?? 'src');
      development = config.command === 'serve';
    },
    resolveId(id) {
      if (!id.endsWith(styleSuffix)) return null;
      const filename = id.slice(0, -styleSuffix.length);
      return isAuthoredComponent(filename) ? id : null;
    },
    async load(id) {
      if (!id.endsWith(styleSuffix)) return null;
      const filename = id.slice(0, -styleSuffix.length);
      if (!isAuthoredComponent(filename)) return null;
      const source = await readFile(filename, 'utf8');
      return compileComponentParts(source, filename).css;
    },
    transform(source, id) {
      const filename = id.split('?', 1)[0]!;
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
