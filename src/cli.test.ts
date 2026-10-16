import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createProject, createRemote, file } from './test-helpers.ts';

import type { SkillReport } from './check-skill.ts';
import type { SkillsLock } from './lock.ts';
import type { TestContext } from 'node:test';

const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));
const lock: SkillsLock = {
  version: 1, skills: { demo: { source: 'acme/skills', sourceType: 'github', skillPath: 'skills/demo/SKILL.md', computedHash: 'old' } },
};

const fixture = async (t: TestContext, skillsLock = lock, installerStatus = 0) => {
  const cwd = await createProject(t);
  const preload = join(cwd, 'preload.mjs');
  const record = join(cwd, 'argv.json');
  const tree = createRemote('skills/demo/', [file('SKILL.md', '---\nname: demo\n---\n')]).tree;
  await writeFile(join(cwd, 'skills-lock.json'), JSON.stringify(skillsLock));
  // This subprocess can only return fixture data; it cannot invoke an installer or the network.
  await writeFile(preload, `
    import childProcess from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.execFileSync = () => { throw new Error('external commands disabled'); };
    childProcess.spawnSync = (command, args, options) => {
      if (command !== 'npx') throw new Error('unexpected command');
      writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args, cwd: options.cwd }));
      return { status: ${installerStatus}, stdout: '\\x1b]0;scu\\x07\\nforged\\x9b', stderr: '' };
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url) => {
      if (!String(url).endsWith('/git/trees/HEAD?recursive=1')) throw new Error('unexpected network request');
      return new Response(JSON.stringify({ tree: ${JSON.stringify(tree)}, truncated: false }));
    };
  `);
  const run = (...args: string[]) => spawnSync(process.execPath, ['--import', preload, cliPath, '--cwd', cwd, ...args], {
    env: { NO_COLOR: '1', PATH: '', GITHUB_TOKEN: 'fixture-only' }, encoding: 'utf8', timeout: 10_000,
  });
  return { run, record, cwd };
};

describe('CLI security regressions', () => {
  for (const installerStatus of [0, 1]) {
    it(`should keep --json -u parseable and escape installer output (exit ${installerStatus})`, async (t) => {
      const { run, record, cwd } = await fixture(t, lock, installerStatus);
      const result = run('--json', '-u');

      assert.equal(result.status, installerStatus, result.stderr);
      const reports = JSON.parse(result.stdout) as SkillReport[];
      assert.equal(reports[0]?.name, 'demo');
      assert.equal(reports[0]?.status, 'not-installed');
      assert.ok(result.stderr.includes('Updating demo...'));
      assert.doesNotMatch(result.stderr, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
      if (installerStatus !== 0) assert.ok(result.stderr.includes('\\u001b]0;scu\\u0007\\u000aforged\\u009b'));
      assert.deepEqual(JSON.parse(await readFile(record, 'utf8')), {
        args: ['--yes', 'skills@1.7.2', 'add', 'acme/skills/skills/demo', '--skill', 'demo', '-y'], cwd,
      });
    });
  }

  it('should reject injected names without spawning and escape their error rows', async (t) => {
    const name = 'demo\x1b[7mX\n::notice::scu-test';
    const skillsLock: SkillsLock = { version: 1, skills: { [name]: lock.skills.demo! } };
    const { run, record } = await fixture(t, skillsLock);
    const result = run('-u');

    assert.equal(result.status, 1, result.stderr);
    assert.equal(existsSync(record), false);
    assert.ok(result.stdout.includes('demo\\u001b[7mX\\u000a::notice::scu-test'));
    assert.doesNotMatch(result.stdout + result.stderr, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
  });

  it('should reject --global from the project lock without invoking an installer', async (t) => {
    const { run, record } = await fixture(t, { version: 1, skills: { '--global': lock.skills.demo! } });
    const result = run('--json', '-u');
    const [report] = JSON.parse(result.stdout) as SkillReport[];
    assert.equal(result.status, 1, result.stderr);
    assert.equal(report?.status, 'error');
    assert.equal(report?.installSource, null);
    assert.equal(existsSync(record), false);
  });

  it('should escape unsupported source text in both text and JSON output without changing JSON values', async (t) => {
    const sourceType = 'local\x1b]0;scu\x07\nforged\x9b\x7f';
    const { run, record } = await fixture(t, {
      version: 1, skills: { demo: { ...lock.skills.demo!, sourceType } },
    });
    const text = run();
    const json = run('--json');
    assert.equal(text.status, 0, text.stderr);
    assert.equal(json.status, 0, json.stderr);
    assert.ok(text.stdout.includes('local\\u001b]0;scu\\u0007\\u000aforged\\u009b\\u007f'));
    for (const result of [text, json]) {
      assert.doesNotMatch(result.stdout + result.stderr, /[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    }
    const [report] = JSON.parse(json.stdout) as SkillReport[];
    assert.equal(report?.message, `${sourceType} sources are not supported yet`);
    assert.equal(existsSync(record), false);
  });
});
