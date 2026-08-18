# Develop-utils Feature Rationale

`develop-utils` packages repeatable repository setup work as a small npm CLI
that can be used from any local project with `npx` or a global install.
Its primary command is `devu`, with `develop-utils` kept as a long-form alias.

## Why This Exists

Repository setup usually starts with the same chores: license files,
authorship notes, line-ending policy, and release automation. Doing that by
hand makes the result inconsistent across projects, and copying scripts from
one repository to another makes future fixes hard to reuse.

This package keeps those setup commands in one place while still generating
plain files in the target repository. The target repo does not need to adopt a
framework or keep `develop-utils` as a runtime dependency.

## Commands

- `add-licenses` creates license, copyright, authorship, and `.gitattributes`
  files from git metadata and optional environment overrides.
- `add-semantic-release` creates semantic-release config and provider-specific
  CI workflow files.
- `pg init` provisions an isolated database and role inside an existing
  PostgreSQL container.
- `git-branches` lists, cleans up, and syncs outdated local git branches.
- `ports` finds and stops the process listening on a given TCP port.
- `node-cleanup` lists and deletes stale `node_modules` directories to
  reclaim disk space.
- `ai-sessions` lists and deletes stale AI agent session transcripts
  (currently Claude Code sessions under `~/.claude/projects`).

## Safety Convention

Commands that can mutate or delete state (`pg init`, `git-branches clean`,
`ports kill`, `node-cleanup clean`, `ai-sessions clean`) follow the same
shape: build a plan, print it under `--dry-run` without touching anything,
confirm interactively before mutating, and support `--yes` to skip the
prompt. The single most destructive option per command additionally
requires `--force`: overwriting an existing `DATABASE_URL`, deleting a
not-fully-merged branch, or sending `SIGKILL` instead of `SIGTERM`.

## Language Support

`add-licenses` is language-agnostic because it only needs git metadata.

`add-semantic-release` supports two execution styles:

- `ci-npx` for Java, Kotlin, Python, Rust, Go, documentation, and other
  non-Node repositories where release automation should not create
  `package.json`.
- `local-node` for Node projects that should install semantic-release into the
  target project with npm, pnpm, or yarn.

The default `auto` mode chooses `local-node` when the target repository already
has `package.json`; otherwise it chooses `ci-npx`.
