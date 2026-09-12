import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';
import { compileComponentParts } from './index.js';

export interface WorkstarPluginOptions {
  source?: string;
}

/** Compile authored components as Vite modules without writing into src. */
export function workstar(options: WorkstarPluginOptions = {}): Plugin {
  let sourceDirectory: string;
  const styleSuffix = '.css?workstar-style';

  function isAuthoredComponent(filename: string): boolean {
    const localPath = relative(sourceDirectory, filename);
    return (
      extname(localPath) === '.workstar' &&
      localPath !== '..' &&
      !localPath.startsWith(`..${sep}`) &&
      !isAbsolute(localPath)
    );
  }

  return {
    name: 'workstar',
    enforce: 'pre',
    configResolved(config) {
      sourceDirectory = resolve(config.root, options.source ?? 'src');
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
      });
      return {
        code: ts.transpileModule(generated.code, {
          fileName: filename,
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
        map: null,
      };
    },
    handleHotUpdate(context) {
      if (!isAuthoredComponent(context.file)) return;
      const stylesheet = context.server.moduleGraph.getModuleById(
        `${context.file}${styleSuffix}`,
      );
      if (!stylesheet) return;
      context.server.moduleGraph.invalidateModule(stylesheet);
      return [...context.modules, stylesheet];
    },
  };
}
