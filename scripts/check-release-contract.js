import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');

function manifest(relativePath) {
  return JSON.parse(readFileSync(resolve(repository, relativePath), 'utf8'));
}

const packages = [
  'package.json',
  'packages/router/package.json',
  'packages/app/package.json',
  'packages/compiler/package.json',
].map(manifest);
const versions = new Map(packages.map(({ name, version }) => [name, version]));
const releaseVersion = versions.get('workstar');

for (const [name, version] of versions) {
  if (version !== releaseVersion) {
    throw new Error(
      `${name}@${version} differs from workstar@${releaseVersion}.`,
    );
  }
}

const app = packages.find(({ name }) => name === 'workstar-app');
if (
  app.dependencies['workstar-router'] !== releaseVersion ||
  app.peerDependencies.workstar !== `^${releaseVersion}`
) {
  throw new Error('workstar-app dependencies do not match the release.');
}

for (const template of ['basic', 'node', 'worker']) {
  const manifestFile = manifest(`templates/${template}/package.json`);
  for (const [name, version] of versions) {
    const requested =
      manifestFile.dependencies?.[name] ?? manifestFile.devDependencies?.[name];
    if (requested && requested !== version) {
      throw new Error(
        `${template} starter requests ${name}@${requested}, expected ${version}.`,
      );
    }
  }
}

process.stdout.write(
  `Release dependency contract matches ${releaseVersion}.\n`,
);
