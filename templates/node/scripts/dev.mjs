import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
execFileSync('npm', ['run', 'build'], { cwd: project, stdio: 'inherit' });

const compiler = fileURLToPath(
  new URL('../node_modules/.bin/workstar-compile', import.meta.url),
);
const tsc = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url));
const children = [
  spawn(
    compiler,
    ['--watch', 'src', '.workstar/generated', '--css', 'public/workstar.css'],
    { cwd: project, stdio: 'inherit' },
  ),
  spawn(tsc, ['--watch', '--preserveWatchOutput'], {
    cwd: project,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['--watch', 'dist/src/server.js'], {
    cwd: project,
    stdio: 'inherit',
  }),
];

let stopping = false;
function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

for (const child of children) {
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
}
process.on('SIGINT', () => stop(130));
process.on('SIGTERM', () => stop(143));
