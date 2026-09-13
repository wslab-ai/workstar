import { basename } from 'node:path';
import {
  SourceMapConsumer,
  SourceMapGenerator,
  type RawSourceMap,
} from 'source-map-js';
import ts from 'typescript';
import type { SourceOrigin } from './source-origin.js';

function positionAt(
  source: string,
  offset: number,
): { line: number; column: number } {
  const before = source.slice(0, offset);
  const newline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: offset - newline - 1,
  };
}

function componentSourceMap(
  authored: string,
  generated: string,
  sourceName: string,
  intermediateName: string,
  origins: readonly SourceOrigin[],
): RawSourceMap {
  const map = new SourceMapGenerator({ file: intermediateName });
  for (const origin of origins) {
    map.addMapping({
      generated: positionAt(generated, origin.generatedOffset),
      original: positionAt(authored, origin.authoredOffset),
      source: sourceName,
    });
  }
  map.setSourceContent(sourceName, authored);
  return map.toJSON();
}

/** Keep authored script locations while lowering generated TypeScript to Vite JavaScript. */
export function transpileComponent(
  generated: string,
  authored: string,
  filename: string,
  origins: readonly SourceOrigin[],
): { code: string; map: RawSourceMap } {
  const intermediateName = `${basename(filename)}.generated.ts`;
  const output = ts.transpileModule(generated, {
    fileName: intermediateName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      sourceMap: true,
      inlineSources: true,
    },
  });
  if (!output.sourceMapText)
    throw new Error('TypeScript did not emit a source map.');
  const typescriptMap = JSON.parse(output.sourceMapText) as RawSourceMap;
  const intermediateSource = typescriptMap.sources[0];
  if (!intermediateSource)
    throw new Error('TypeScript emitted an empty source map.');
  const authoredMap = componentSourceMap(
    authored,
    generated,
    filename,
    intermediateName,
    origins,
  );
  const composed = SourceMapGenerator.fromSourceMap(
    new SourceMapConsumer(typescriptMap),
  );
  composed.applySourceMap(
    new SourceMapConsumer(authoredMap),
    intermediateSource,
  );
  composed.setSourceContent(filename, authored);
  return {
    code: output.outputText.replace(/^\/\/# sourceMappingURL=.*\n?/m, ''),
    map: composed.toJSON(),
  };
}
