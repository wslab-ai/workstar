import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cli = resolve('bin/workstar.js');

describe('project starter', () => {
  it('creates a named project without overwriting it', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'workstar-cli-'));
    const project = join(temporary, 'my-app');

    try {
      execFileSync(process.execPath, [cli, 'create', project]);
      expect(existsSync(join(project, 'src/main.ts'))).toBe(true);
      expect(
        JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).name,
      ).toBe('my-app');
      expect(() =>
        execFileSync(process.execPath, [cli, 'create', project], {
          stdio: 'pipe',
        }),
      ).toThrow();
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
