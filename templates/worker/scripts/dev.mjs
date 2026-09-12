import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const compiler = fileURLToPath(
  new URL('../node_modules/.bin/workstar-compile', import.meta.url),
);
const wrangler = fileURLToPath(
  new URL('../node_modules/.bin/wrangler', import.meta.url),
);

const children = [
  spawn(
    compiler,
    ['--watch', 'src', '.workstar/generated', '--css', 'public/workstar.css'],
    {
      cwd: project,
      stdio: 'inherit',
    },
  ),
  spawn(wrangler, ['dev', '--local', ...process.argv.slice(2)], {
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
