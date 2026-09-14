#!/usr/bin/env node
import { resolve } from 'node:path';
import {
  compileViewFile,
  compileForeignFile,
  compileViewDirectory,
  watchViewDirectory,
  auditForeignDirectory,
} from '../dist/src/project.js';

const args = process.argv.slice(2);
try {
  const cssOption =
    (args.length === 5 && args[3] === '--css') ||
    (args.length === 4 && args[2] === '--css')
      ? { cssOutputPath: resolve(args.at(-1)) }
      : {};
  if (args.length === 2 && args[0] === '--compat-audit') {
    const report = await auditForeignDirectory(resolve(args[1]));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (
    (args.length === 3 || (args.length === 5 && args[3] === '--css')) &&
    args[0] === '--all'
  ) {
    await compileViewDirectory(resolve(args[1]), resolve(args[2]), cssOption);
  } else if (
    (args.length === 3 || (args.length === 5 && args[3] === '--css')) &&
    args[0] === '--watch'
  ) {
    await watchViewDirectory(
      resolve(args[1]),
      resolve(args[2]),
      (error) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
      },
      cssOption,
    );
    process.stdout.write(
      `Watching ${resolve(args[1])} for .workstar changes.\n`,
    );
  } else if (
    (args.length === 3 || (args.length === 5 && args[3] === '--css')) &&
    args[0] === '--compat' &&
    /\.(tsx|vue)$/.test(args[1] ?? '') &&
    args[2]?.endsWith('.ts')
  ) {
    await compileForeignFile(resolve(args[1]), resolve(args[2]), cssOption);
  } else if (
    (args.length === 2 || (args.length === 4 && args[2] === '--css')) &&
    args[0]?.endsWith('.workstar') &&
    args[1]?.endsWith('.ts')
  ) {
    const [input, output] = args;
    await compileViewFile(resolve(input), resolve(output), cssOption);
  } else {
    process.stderr.write(
      'Usage: workstar-compile input.workstar output.ts [--css public/components.css]\n' +
        '       workstar-compile --compat input.tsx|input.vue output.ts [--css public/components.css]\n' +
        '       workstar-compile --all source-directory output-directory [--css public/components.css]\n' +
        '       workstar-compile --compat-audit source-directory\n' +
        '       workstar-compile --watch source-directory output-directory [--css public/components.css]\n',
    );
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
