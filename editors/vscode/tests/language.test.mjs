import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import textmate from 'vscode-textmate';
import oniguruma from 'vscode-oniguruma';

const { Registry, parseRawGrammar } = textmate;

const require = createRequire(import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const configuration = JSON.parse(
  readFileSync(
    new URL('../language-configuration.json', import.meta.url),
    'utf8',
  ),
);
const snippets = JSON.parse(
  readFileSync(new URL('../snippets/workstar.json', import.meta.url), 'utf8'),
);
const grammarPath = new URL(
  '../syntaxes/workstar.tmLanguage.json',
  import.meta.url,
);
const grammarSource = readFileSync(grammarPath, 'utf8');

test('the VS Code manifest declares one .workstar language and real embedded scopes', () => {
  assert.equal(manifest.contributes.languages[0].id, 'workstar');
  assert.deepEqual(manifest.contributes.languages[0].extensions, ['.workstar']);
  assert.deepEqual(manifest.contributes.grammars[0].embeddedLanguages, {
    'meta.embedded.block.typescript': 'typescript',
    'meta.embedded.block.css': 'css',
  });
  assert.equal(configuration.comments.blockComment[0], '<!--');
  assert.ok(
    Object.values(snippets).some((snippet) => snippet.prefix === 'ws-each'),
  );
});

test('the grammar tokenizes script, style, controls, events and path expressions', async () => {
  const wasm = readFileSync(
    require.resolve('vscode-oniguruma/release/onig.wasm'),
  );
  await oniguruma.loadWASM(
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
  );
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (sources) => new oniguruma.OnigScanner(sources),
      createOnigString: (source) => new oniguruma.OnigString(source),
    }),
    loadGrammar: async (scope) => {
      if (scope === 'text.html.workstar')
        return parseRawGrammar(grammarSource, grammarPath.pathname);
      return { scopeName: scope, patterns: [] };
    },
  });
  const grammar = await registry.loadGrammar('text.html.workstar');
  assert.ok(grammar);

  const source = [
    '<script lang="ts">',
    'const count = signal(0);',
    '</script>',
    '<If when="{count.value}">',
    '  <button on:click="{increment}">{count.value}</button>',
    '</If>',
    '<style>',
    '.button { color: red; }',
    '</style>',
  ];
  let stack = null;
  const scopes = [];
  for (const line of source) {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    scopes.push(...result.tokens.map((token) => token.scopes));
  }
  const hasScope = (scope) => scopes.some((token) => token.includes(scope));
  assert.ok(hasScope('meta.embedded.block.typescript'));
  assert.ok(hasScope('meta.embedded.block.css'));
  assert.ok(hasScope('entity.name.tag.control.workstar'));
  assert.ok(hasScope('entity.other.attribute-name.event.workstar'));
  assert.ok(hasScope('variable.other.readwrite.workstar'));
});
