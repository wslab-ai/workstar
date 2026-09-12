#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , command, directory, option, templateName] = process.argv;

if (command === '--help' || command === '-h' || command === undefined) {
  process.stdout.write(
    'Usage: workstar create <project-directory> [--template basic|worker]\n',
  );
  process.exit(command === undefined ? 1 : 0);
}

if (
  command !== 'create' ||
  !directory ||
  (option !== undefined && option !== '--template') ||
  (option === '--template' && !['basic', 'worker'].includes(templateName)) ||
  (option === undefined && templateName !== undefined)
) {
  process.stderr.write(
    'Expected: workstar create <project-directory> [--template basic|worker]\n',
  );
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
  `../templates/${templateName ?? 'basic'}`,
);
cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
const manifestPath = resolve(target, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.name = packageName;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
if (templateName === 'worker') {
  renameSync(resolve(target, 'gitignore.txt'), resolve(target, '.gitignore'));
  const configPath = resolve(target, 'wrangler.jsonc');
  const config = readFileSync(configPath, 'utf8').replace(
    'workstar-worker-starter',
    packageName,
  );
  writeFileSync(configPath, config);
}

process.stdout.write(
  `Created ${target}\n\nNext steps:\n  cd ${directory}\n  npm install\n  npm run dev\n`,
);
