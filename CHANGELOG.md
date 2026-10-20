# Changelog

Release history for `skills-check-updates`.

## [0.3.1] - 2026-10-20

### Security

- `--upgrade` checks that the installer recorded the upstream version scu checked. When upstream changes between the check and the install, the skill's previous files and the lock are restored and the update is skipped, so a push during the update can no longer bypass `--min-age` or a planned merge.

## [0.3.0] - 2026-10-18

### Added

- `--ui` opens an offline, interactive map of the project's locked skills, grouped by source repository, with search, collapsible branches and zoom.
- Select a skill to read its local `SKILL.md`, declared version and file count; missing and unreadable skills remain visible.
- Apply the existing name, `--from` and `--skip` filters to the map without checking upstream or modifying installed skills.

### Security

- Deliver the map from memory through a one-time, token-protected loopback URL with caching disabled; the server closes after delivery or five minutes.
- Display skill instructions as inert text and reject combinations of `--ui` with update or report options.

## [0.2.1] - 2026-10-16

### Security

- Pin the `skills` CLI that `--upgrade` runs to 1.7.2, the version whose folder hashing, name normalization and lock format scu mirrors, instead of `skills@latest`. A new or compromised `skills` release no longer runs automatically, and newer versions are adopted only after a deliberate bump.

## [0.2.0] - 2026-10-16

### Added

- `--upgrade` merges local edits with upstream changes file by file through `git merge-file`, using the upstream commit that reproduces the lock's `computedHash` as the base.

### Changed

- Skills with both local and upstream changes are now update targets: `--upgrade` merges them, skips them when the changes overlap and overwrites them only with `--force`. They count towards `--exit-code` 2, and a skipped merge makes `--upgrade` exit with 1.
- With `--upgrade`, the JSON report includes a `merge` field for those skills.

## [0.1.0] - 2026-10-15

Initial public release.

### Added

- Read-only checks for newer GitHub versions of skills listed in `skills-lock.json`.
- The `skills-check-updates` command and its `scu` alias, with optional updates through `--upgrade` and explicit overwrites through `--force`.
- Skill selection by name or wildcard, with `--skip` and `--from` filters.
- Detailed reports showing commits, versions, changed files and compare links, with up to 20 upstream commits inspected per skill.
- Optional age-based holds for detected upstream updates through `--min-age`.
- JSON reports, CI exit codes, GitHub token support and a terminal progress indicator.

### Security

- Reject installer flags, path separators and control characters in skill names before checking or installing.
- Build installation sources from the same GitHub repository used for the update check.
- Check skill destination roots and symlink targets for project containment before reading files and immediately before installation.
- Reject upstream folder names containing installer syntax such as `#` and `@`.
- Escape untrusted control characters in reports, progress labels, errors and installer output.

### Fixed

- Match installed directory names to the `skills` CLI's name normalization so local edits and age holds are recognized for names such as `My Skill`.
- Keep `--json --upgrade` output valid JSON by sending upgrade messages to stderr.

[0.3.1]: https://github.com/irekrog/skills-check-updates/releases/tag/v0.3.1
[0.3.0]: https://github.com/irekrog/skills-check-updates/releases/tag/v0.3.0
[0.2.1]: https://github.com/irekrog/skills-check-updates/releases/tag/v0.2.1
[0.2.0]: https://github.com/irekrog/skills-check-updates/releases/tag/v0.2.0
[0.1.0]: https://github.com/irekrog/skills-check-updates/releases/tag/v0.1.0
