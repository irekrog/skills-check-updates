# skills-check-updates

`npm-check-updates` for agent skills. Reads the `skills-lock.json` written by the [`skills`](https://github.com/vercel-labs/skills) CLI, compares every skill with its GitHub source and reports what changed - without touching anything unless you ask.

```
$ npx skills-check-updates

 find-skills                 update available                  https://github.com/vercel-labs/skills/tree/HEAD/skills/find-skills
 react-useeffect             up to date, lock needs skillPath  https://github.com/softaworks/agent-toolkit/tree/HEAD/skills/react-useeffect
 resolving-merge-conflicts   not found upstream                https://github.com/mattpocock/skills
 tdd                         update available                  https://github.com/mattpocock/skills/tree/HEAD/skills/engineering/tdd

28 skills up to date.
Run scu -u to update 3 skills.
```

## Why

`npx skills check` is an alias of `npx skills update`: it reinstalls right away, there is no read-only preview. It also silently overwrites local edits, and it cannot update skills whose lock entry has no `skillPath` (installed by older CLI versions).

## Usage

```bash
npx skills-check-updates            # report only
npx skills-check-updates -u         # reinstall outdated skills
npx skills-check-updates -u --force # also overwrite skills with local changes
npx skills-check-updates tdd shadcn # check selected skills
npx skills-check-updates 'grill*'   # names accept * wildcards
npx skills-check-updates --details  # commits, changed files and compare links
npx skills-check-updates --json     # machine-readable report
```

### Choosing skills

```bash
scu --skip shadcn                   # leave out a skill
scu --skip 'grill*,tdd'             # repeatable, comma separated, wildcards
scu --from mattpocock/skills        # only skills installed from this repo
scu --from 'vercel-labs/*'          # any repo of an owner
```

A misspelled exact name shows up as an error row instead of being ignored.

### Letting changes settle: `--min-age`

A skill is a set of instructions your agent follows with access to your tools, so a bad or hijacked upstream commit lands straight in its prompt. `--min-age` holds an update back until the newest change to the skill folder is old enough for problems to surface:

```bash
scu --min-age 7d      # also 7 (days), 12h, 30m
scu -u --min-age 7d   # held updates are skipped, even with --force
```

```
 shadcn  update available, held until 2026-10-28  https://github.com/shadcn/ui/tree/HEAD/skills/shadcn
```

The whole update waits for the newest change - installing an older, already settled commit would pin the lock entry to that commit and stop future checks from seeing anything newer.

### CI: `--exit-code`

```bash
scu --exit-code --min-age 7d
```

| Exit code | Meaning |
| --- | --- |
| 0 | nothing to update |
| 1 | an error (network, lock file, failed upgrade) |
| 2 | updates are available |

Without `--exit-code` a successful check always exits with 0.

`--details` (`-d`) expands every row:

```
 tdd  update available
     installed  3216582  2026-08-19  Remove all em-dashes from the repo
     latest     3f59913  2026-10-07  tdd: note what each proposed seam catches and misses (#1192)
     behind     2 commits
     hash       e753a5da7529 → daf55026f456
     changes    ~ SKILL.md
     compare    https://github.com/mattpocock/skills/compare/321658273cb1...3f599139104d
     source     https://github.com/mattpocock/skills/tree/HEAD/skills/engineering/tdd

 resolving-merge-conflicts  not found upstream
     removed    daa01d8  2026-09-24  Remove resolving-merge-conflicts
     source     https://github.com/mattpocock/skills
```

- `installed` is the upstream commit whose folder content matches the local copy (searched in the last 20 commits that touched the folder), `latest` is the newest of them.
- `behind` counts commits that touched the skill folder, not the whole repo.
- `version` appears when `SKILL.md` declares one in its frontmatter - it is informational only, authors rarely bump it.
- `changes` lists files added (`+`), modified (`~`) and removed (`-`) upstream relative to the local copy.
- With skill names given, up-to-date skills are listed too: `scu -d tdd`.

Details cost one extra GitHub API request per skill plus one per older commit inspected, so a token is strongly recommended.

`scu` is a short alias for the same binary.

| Status | Meaning | `-u` |
| --- | --- | --- |
| update available | upstream changed, local copy untouched | reinstalls |
| local changes | local copy edited, upstream unchanged | only with `--force` |
| local changes + update available | both changed | only with `--force` |
| up to date, lock needs skillPath | content current, but the lock has no or a moved `skillPath` | reinstalls to record the path |
| not installed | in the lock, missing on disk | reinstalls |
| not found upstream | the skill was removed from its repo | - |

## How it works

- The lock's `computedHash` is a SHA-256 over every file in the skill's source folder. The tool rebuilds that hash from the current upstream tree and compares.
- Files whose git blob sha matches a local file are not downloaded - a typical run needs one GitHub API request per source repo.
- When the lock hash cannot prove the local copy is untouched (hashes written by older CLI versions do not always reproduce), the local copy is compared with the last 20 upstream versions of the folder before it is reported as edited.
- Lock entries without `skillPath`, or with a path that no longer exists, are located by their `SKILL.md` frontmatter name.
- `-u` runs `npx skills@latest add <source>/<folder> --skill <name> -y` per skill, the same command `npx skills update` uses, so skills land in the same agent folders and the lock is updated by the official CLI.

GitHub requests use `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token` when available; without a token the API allows 60 requests per hour.

## Limitations

- GitHub sources only (`sourceType: "github"`). Other sources are reported as unsupported.
- Project lock only (`skills-lock.json`), not the global `~/.agents/.skill-lock.json`.
- Skill names must start with an ASCII letter or digit and contain only ASCII letters, digits, spaces, dots, underscores, colons or hyphens. Installed folders use the same name normalization as the `skills` CLI.
- `.agents`, `.claude` and their `skills` folders must be real directories inside the project. Individual skill symlinks are accepted when they resolve inside the project.
- Upstream skill folders containing `#`, `@`, `:`, backslashes or terminal control characters are rejected because they cannot be passed literally to the installer.

## Releases

See [CHANGELOG.md](CHANGELOG.md) for the release history and [GitHub Releases](https://github.com/irekrog/skills-check-updates/releases) for versioned release notes.

## Development

```bash
pnpm install
pnpm test       # node --test, runs TypeScript directly (Node >= 22.18)
pnpm typecheck
pnpm build
```
