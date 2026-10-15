import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findSkillPath } from './find-skill-path.ts';
import { createRemote, file } from './test-helpers.ts';

describe('findSkillPath', () => {
  it('should find the skill in a folder named after it', async () => {
    const remote = createRemote('', [
      file('skills/other/SKILL.md', '---\nname: other\n---\n'),
      file('skills/demo/SKILL.md', '---\nname: demo\n---\n'),
    ]);

    assert.equal(await findSkillPath('demo', remote.tree, remote.readRemoteFile), 'skills/demo/SKILL.md');
    assert.deepEqual(remote.downloads, ['skills/demo/SKILL.md']);
  });

  it('should find the skill by its frontmatter name when the folder differs', async () => {
    const remote = createRemote('', [file('skills/best-practices/SKILL.md', '---\nname: vendor-best-practices\n---\n')]);

    assert.equal(
      await findSkillPath('vendor-best-practices', remote.tree, remote.readRemoteFile),
      'skills/best-practices/SKILL.md',
    );
  });

  it('should skip a same-named folder whose frontmatter names another skill', async () => {
    const remote = createRemote('', [
      file('legacy/demo/SKILL.md', '---\nname: demo-legacy\n---\n'),
      file('skills/renamed/SKILL.md', '---\nname: demo\n---\n'),
    ]);

    assert.equal(await findSkillPath('demo', remote.tree, remote.readRemoteFile), 'skills/renamed/SKILL.md');
  });

  it('should prefer the shallowest copy of a skill', async () => {
    const remote = createRemote('', [
      file('dist/plugins/demo/skills/demo/SKILL.md', '---\nname: demo\n---\n'),
      file('skills/demo/SKILL.md', '---\nname: demo\n---\n'),
    ]);

    assert.equal(await findSkillPath('demo', remote.tree, remote.readRemoteFile), 'skills/demo/SKILL.md');
  });

  it('should return null when no skill has the name', async () => {
    const remote = createRemote('', [file('skills/other/SKILL.md', '---\nname: other\n---\n')]);

    assert.equal(await findSkillPath('demo', remote.tree, remote.readRemoteFile), null);
  });
});
