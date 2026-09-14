import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const files = [
  'dist/index.js',
  'dist/reactivity.js',
  'dist/store.js',
  'dist/template-model.js',
  'dist/attribute-value.js',
  'dist/template.js',
];
const total = files.reduce(
  (size, file) => size + gzipSync(readFileSync(file)).byteLength,
  0,
);
const limit = 8 * 1024;

process.stdout.write(
  `Framework runtime: ${total} bytes gzip (limit ${limit}).\n`,
);
if (total > limit) process.exitCode = 1;
