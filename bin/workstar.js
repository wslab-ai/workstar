#!/usr/bin/env node

import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , command, directory] = process.argv;

if (command === '--help' || command === '-h' || command === undefined) {
  process.stdout.write('Usage: workstar create <project-directory>\n');
  process.exit(command === undefined ? 1 : 0);
}

if (command !== 'create' || !directory) {
  process.stderr.write('Expected: workstar create <project-directory>\n');
  process.exit(1);
}

const target = resolve(directory);
if (existsSync(target)) {
  process.stderr.write(`Refusing to overwrite existing path: ${target}\n`);
  process.exit(1);
}

const packageName = basename(target)
  .toLowerCase()
  .replace(/[^a-z0-9._-]/g, '-')
  .replace(/^[^a-z0-9]+/, '')
  .replace(/[^a-z0-9]+$/, '');
if (!packageName) {
  process.stderr.write('Project directory needs a valid package name.\n');
  process.exit(1);
}

const source = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../templates/basic',
);
cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
const manifestPath = resolve(target, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.name = packageName;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

process.stdout.write(
  `Created ${target}\n\nNext steps:\n  cd ${directory}\n  npm install\n  npm run dev\n`,
);
