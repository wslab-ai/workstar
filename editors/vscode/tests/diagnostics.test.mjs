import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { checkComponent } = require('../out/compiler-check.js');
const filename = '/project/src/card.workstar';

test('the editor checks unsaved component source with the project compiler', async () => {
  let received;
  const result = await checkComponent('<p>Draft</p>', filename, async () => ({
    compileComponentParts(source, path) {
      received = { source, path };
    },
  }));
  assert.deepEqual(received, { source: '<p>Draft</p>', path: filename });
  assert.deepEqual(result, { status: 'valid' });
});

test('compiler source locations survive the editor boundary', async () => {
  const result = await checkComponent('<If>Bad</If>', filename, async () => ({
    compileComponentParts() {
      const error = new Error(`${filename}:2:5: Missing when attribute`);
      error.name = 'ComponentCompileError';
      error.description = 'Missing when attribute';
      error.position = { line: 2, column: 5 };
      throw error;
    },
  }));
  assert.deepEqual(result, {
    status: 'invalid',
    message: 'Missing when attribute',
    position: { line: 2, column: 5 },
  });
});

test('older compiler errors and unavailable compilers stay actionable', async () => {
  const old = await checkComponent('', filename, async () => ({
    compileComponentParts() {
      const error = new Error(`${filename}: Bad syntax`);
      error.name = 'ComponentCompileError';
      throw error;
    },
  }));
  assert.equal(old.status, 'invalid');
  assert.equal(old.message, 'Bad syntax');
  assert.equal(old.position, undefined);

  const absent = await checkComponent('', filename, async () => null);
  assert.equal(absent.status, 'unavailable');
  assert.match(absent.message, /Install workstar-compiler/);
});

test('unexpected compiler failures are not mistaken for authoring errors', async () => {
  const result = await checkComponent('', filename, async () => ({
    compileComponentParts() {
      throw new Error('Package load failed');
    },
  }));
  assert.deepEqual(result, {
    status: 'failed',
    message: 'Workstar compiler could not run: Package load failed',
  });
});

test('the editor loads an ESM-only compiler from the project node_modules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workstar-vscode-'));
  try {
    const compilerRoot = join(root, 'node_modules', 'workstar-compiler');
    await mkdir(join(compilerRoot, 'dist'), { recursive: true });
    await mkdir(join(root, 'src'));
    await writeFile(
      join(compilerRoot, 'package.json'),
      JSON.stringify({
        type: 'module',
        exports: { '.': { import: './dist/index.js' } },
      }),
    );
    await writeFile(
      join(compilerRoot, 'dist', 'index.js'),
      "export function compileComponentParts(source) { if (source === 'bad') { const error = new Error('Bad component'); error.name = 'ComponentCompileError'; error.description = 'Bad component'; error.position = { line: 2, column: 3 }; throw error; } }",
    );
    const componentPath = join(root, 'src', 'card.workstar');
    assert.deepEqual(await checkComponent('good', componentPath), {
      status: 'valid',
    });
    assert.deepEqual(await checkComponent('bad', componentPath), {
      status: 'invalid',
      message: 'Bad component',
      position: { line: 2, column: 3 },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
