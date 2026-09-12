import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repository = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'workstar-packaged-starter-'));

function manifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function pack(packageName) {
  const workspace =
    packageName === 'workstar' ? [] : ['--workspace', packageName];
  const output = execFileSync(
    'npm',
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporary,
      ...workspace,
    ],
    { cwd: repository, encoding: 'utf8' },
  );
  const [result] = JSON.parse(output);
  if (!result?.filename) throw new Error(`Could not pack ${packageName}.`);
  return join(temporary, result.filename);
}

try {
  const compilerPackage = pack('workstar-compiler');
  const compilerFiles = execFileSync('tar', ['-tzf', compilerPackage], {
    encoding: 'utf8',
  });
  for (const filename of [
    'package/bin/workstar-compile.mjs',
    'package/dist/src/index.js',
    'package/dist/src/project.js',
    'package/dist/src/vite.js',
    'package/README.md',
    'package/LICENSE',
  ]) {
    if (!compilerFiles.split('\n').includes(filename)) {
      throw new Error(`Compiler package is missing ${filename}.`);
    }
  }

  const packageArchives = {
    workstar: pack('workstar'),
    'workstar-router': pack('workstar-router'),
    'workstar-app': pack('workstar-app'),
    'workstar-compiler': compilerPackage,
  };
  const extracted = join(temporary, 'installed');
  mkdirSync(extracted);
  execFileSync('tar', ['-xzf', packageArchives.workstar, '-C', extracted]);
  const packagedRoot = join(extracted, 'package');
  const expectedVersions = Object.fromEntries(
    ['workstar', 'workstar-router', 'workstar-app', 'workstar-compiler'].map(
      (name) => [
        name,
        manifest(
          name === 'workstar'
            ? join(repository, 'package.json')
            : join(
                repository,
                'packages',
                name.slice('workstar-'.length),
                'package.json',
              ),
        ).version,
      ],
    ),
  );

  for (const template of ['basic', 'worker']) {
    const project = join(temporary, `packed-${template}`);
    const options = template === 'worker' ? ['--template', template] : [];
    execFileSync(process.execPath, [
      join(packagedRoot, 'bin/workstar.js'),
      'create',
      project,
      ...options,
    ]);
    const generated = manifest(join(project, 'package.json'));
    const dependencies =
      template === 'worker'
        ? ['workstar', 'workstar-router', 'workstar-app', 'workstar-compiler']
        : ['workstar', 'workstar-compiler'];
    for (const name of dependencies) {
      const version = expectedVersions[name];
      const dependency =
        generated.dependencies?.[name] ?? generated.devDependencies?.[name];
      if (dependency !== version) {
        throw new Error(
          `${template} starter uses ${dependency} for ${name}; expected ${version}.`,
        );
      }
    }
    if (!existsSync(join(project, '.gitignore'))) {
      throw new Error(`${template} starter omitted .gitignore.`);
    }

    // Install only local tarballs for Workstar packages; no npm publication is needed.
    for (const name of dependencies) {
      const section =
        name in (generated.dependencies ?? {})
          ? 'dependencies'
          : 'devDependencies';
      generated[section][name] = `file:${packageArchives[name]}`;
    }
    writeFileSync(
      join(project, 'package.json'),
      `${JSON.stringify(generated, null, 2)}\n`,
    );
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: project,
      stdio: 'inherit',
    });
    execFileSync('npm', ['run', 'check'], { cwd: project, stdio: 'inherit' });
    if (template === 'basic') {
      execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'inherit' });
    } else {
      execFileSync('npm', ['exec', '--', 'wrangler', 'deploy', '--dry-run'], {
        cwd: project,
        stdio: 'inherit',
      });
    }
  }

  process.stdout.write(
    'Packed compiler contents and checkout-independent basic/Worker install and build passed.\n',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
