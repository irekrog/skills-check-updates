import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get } from 'node:http';
import { Script } from 'node:vm';
import { describe, it } from 'node:test';

import { createProject, file, writeSkillFiles } from './test-helpers.ts';
import { readUiSkills, renderUi, serveUi } from './ui.ts';

import type { SkillsLock } from './lock.ts';

const entry = { source: 'acme/skills', sourceType: 'github', computedHash: 'unused' };

describe('ui skill map', () => {
  it('reads selected local skills and distinguishes missing, unsafe and unknown entries', async (t) => {
    const cwd = await createProject(t);
    const markdown = '---\nname: demo\nmetadata:\n  version: "1.2"\n---\nLocal instructions.';
    await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', markdown), file('references/a.md', 'reference')]);
    await writeSkillFiles(cwd, '.claude/skills/other', [file('SKILL.md', '')]);
    const lock: SkillsLock = { version: 1, skills: { demo: entry, other: { ...entry, sourceType: 'local', source: 'javascript:alert(1)' }, missing: entry, '../outside': entry } };
    const skills = await readUiSkills(cwd, lock, ['demo', 'other', 'missing', '../outside', 'unknown']);
    assert.deepEqual(skills.map((skill) => skill.status), ['installed', 'installed', 'missing', 'error', 'error']);
    assert.equal(skills[0]?.markdown, markdown);
    assert.equal(skills[0]?.version, '1.2');
    assert.equal(skills[0]?.files, 2);
    assert.equal(skills[0]?.url, 'https://github.com/acme/skills');
    assert.equal(skills[1]?.url, null);
    assert.match(skills[3]?.message ?? '', /invalid skill name/);
    assert.match(skills[4]?.message ?? '', /not in skills-lock.json/);
    assert.equal((await readUiSkills(cwd, lock, ['missing'])).length, 1);
  });

  it('embeds hostile instructions and project names as inert JSON with a valid UI script', async (t) => {
    const cwd = await createProject(t);
    const attack = '</script><script>globalThis.compromised=true</script><!-- & \u2028 $& $\' $`';
    await writeSkillFiles(cwd, '.agents/skills/demo', [file('SKILL.md', attack)]);
    const skills = await readUiSkills(cwd, { version: 1, skills: { demo: { ...entry, source: attack } } }, ['demo']);
    const html = renderUi(attack, skills);
    assert.equal(html.includes(attack), false);
    const json = html.match(/<script type="application\/json" id="skill-data">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(json);
    assert.deepEqual(JSON.parse(json), { project: attack, skills });
    const script = html.match(/<script>\n([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Script(script));
    for (const [, id] of script.matchAll(/\$\('([\w-]+)'\)/g)) {
      assert.ok(html.includes(`id="${id}"`), `missing UI element: ${id}`);
    }
    assert.match(html, /id="detail"[^>]*hidden/);
    assert.doesNotMatch(html, /<link\b|<header\b|<footer\b/);
    assert.doesNotMatch(script, /innerHTML|document\.write|fetch\(/);
    assert.equal((html.match(/<script/g) ?? []).length, 2);
    assert.ok(renderUi('empty', []).includes('"skills":[]'));
  });

  it('keeps malformed lock metadata from breaking the browser skill map', async (t) => {
    const cwd = await createProject(t);
    const lock = JSON.parse('{"version":1,"skills":{"bad":{"source":42,"sourceType":"github"}}}') as SkillsLock;
    const [skill] = await readUiSkills(cwd, lock, ['bad']);
    assert.equal(skill?.status, 'error');
    assert.equal(skill?.source, 'Unknown source');
    assert.match(skill?.message ?? '', /Invalid skill entry/);
  });
});

describe('private ui delivery', () => {
  it('requires the token and local host, serves once without caching, then closes', async (t) => {
    const html = renderUi('private', []);
    const { url, server } = await serveUi(html);
    t.after(() => { server.close(); server.closeAllConnections(); });
    assert.equal((server.address() as { address: string }).address, '127.0.0.1');
    assert.match(new URL(url).pathname, /^\/[a-f0-9]{64}$/);
    for (const [target, options] of [
      [new URL('/wrong-token', url), {}],
      [url, { method: 'POST' }],
    ] as const) {
      const response = await fetch(target, options);
      assert.equal(response.status, 404);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { Host: 'attacker.invalid' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(foreignHostStatus, 404);
    const closed = once(server, 'close');
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal(await response.text(), html);
    await closed;
    await assert.rejects(fetch(url));
  });

  it('expires an unused address after five minutes', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { server } = await serveUi('private');
    t.after(() => { server.close(); server.closeAllConnections(); });
    const closed = once(server, 'close');
    t.mock.timers.tick(5 * 60_000);
    await closed;
    assert.equal(server.listening, false);
  });
});
