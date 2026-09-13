import { SourceMapConsumer } from 'source-map-js';
import { describe, expect, it } from 'vitest';
import { compileComponentParts } from '../src/index.js';
import { transpileComponent } from '../src/source-map.js';

describe('Vite component source maps', () => {
  it('maps executable script lines to their authored .workstar positions', () => {
    const filename = '/project/src/counter.workstar';
    const source = `<script lang="ts">
import { signal } from 'workstar';
const count = signal(0);
function increment() {
  count.update((value) => value + 1);
}
</script>
<button on:click="{increment}">{count.value}</button>`;
    const generated = compileComponentParts(source, filename, {
      componentImports: 'source',
    });
    const output = transpileComponent(
      generated.code,
      source,
      filename,
      generated.origins,
    );
    const map = new SourceMapConsumer(output.map);
    const lines = output.code.split('\n');
    const update = lines.findIndex((line) => line.includes('count.update'));
    const column = lines[update]!.indexOf('count.update');
    expect(map.originalPositionFor({ line: update + 1, column })).toMatchObject(
      {
        source: filename,
        line: 5,
        column: 2,
      },
    );
    expect(map.sourceContentFor(filename)).toBe(source);
    expect(output.code).not.toContain('sourceMappingURL');
  });

  it('anchors generated markup after the script, not a tag-like script string', () => {
    const filename = '/project/src/page.workstar';
    const source = `<script lang="ts">
const example = '<fake>';
</script>
<main>{example}</main>`;
    const generated = compileComponentParts(source, filename);
    const output = transpileComponent(
      generated.code,
      source,
      filename,
      generated.origins,
    );
    const lines = output.code.split('\n');
    const markup = lines.findIndex((line) => line.includes('return __html'));
    const map = new SourceMapConsumer(output.map);
    expect(
      map.originalPositionFor({
        line: markup + 1,
        column: lines[markup]!.indexOf('return __html'),
      }),
    ).toMatchObject({ source: filename, line: 4, column: 0 });
  });

  it('keeps repeated statements distinct after import rewriting', () => {
    const filename = '/project/src/repeated.workstar';
    const source = `<script lang="ts">
import { signal } from 'workstar';
const first = signal(0);
function firstAction() {
  first.value = 1;
}
function secondAction() {
  first.value = 1;
}
</script>
<button on:click="{secondAction}">{first.value}</button>`;
    const generated = compileComponentParts(source, filename);
    const output = transpileComponent(
      generated.code,
      source,
      filename,
      generated.origins,
    );
    const lines = output.code.split('\n');
    const repeated = lines.flatMap((line, index) =>
      line.includes('first.value = 1') ? [index] : [],
    );
    const map = new SourceMapConsumer(output.map);
    expect(repeated).toHaveLength(2);
    expect(
      repeated.map(
        (index) =>
          map.originalPositionFor({
            line: index + 1,
            column: lines[index]!.indexOf('first.value = 1'),
          }).line,
      ),
    ).toEqual([5, 8]);
  });
});
