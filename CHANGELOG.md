# Changelog

Release history for `skills-check-updates`.

## [Unreleased]

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

[0.1.0]: https://github.com/irekrog/skills-check-updates/releases/tag/v0.1.0
