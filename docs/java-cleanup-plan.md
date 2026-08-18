# Java Cleanup Design

## Product Summary

`devu java-cleanup` reclaims disk space and tidies up two distinct kinds of
Java-related buildup: old JDK installations left behind by a version manager
(`jdks`), and stale Maven/Gradle build output directories scattered across a
workspace (`builds`). These are deliberately kept as two separate
subcommand namespaces rather than one, because they touch very different
things (a system-wide toolchain vs. per-project build artifacts) with very
different risk profiles.

## Problem Statement

Developers accumulate JDK versions over years of project work (via sdkman,
jenv, or jabba) and rarely clean up ones they no longer use — each is
several hundred MB. Separately, every Maven/Gradle project leaves a
`target/`/`build/` directory that can be regenerated at any time but often
isn't cleaned, especially across many checked-out repositories. Both are
safe to delete in principle, but risky to get wrong: deleting the wrong JDK
can break other tooling, and deleting build output for a project the
developer is mid-work on is annoying (though harmless, since it's
regenerable).

## Scope

**Implemented (MVP):**

- `devu java-cleanup jdks list` — list installed JDKs for a detected or
  specified version manager (sdkman, jenv, jabba), flagging the active one.
- `devu java-cleanup jdks clean` — delete installed JDKs that are not the
  active version and not explicitly kept.
- `devu java-cleanup builds list` — list Maven/Gradle build output
  directories under a root, flagging stale ones.
- `devu java-cleanup builds clean` — delete stale Maven/Gradle build output
  directories, skipping projects with uncommitted git changes.

**Out of scope for MVP:**

- Installing or switching JDK versions (this tool only removes).
- Windows support for `jdks` (see Cross-Platform Notes).
- Any build tool other than Maven and Gradle (no Bazel, Ant, sbt, etc.).
- Cleaning Gradle's global caches (`~/.gradle/caches`) or Maven's local
  repository (`~/.m2/repository`) — only per-project build output
  directories are in scope.

## Command Design

```bash
devu java-cleanup jdks list [--manager sdkman|jenv|jabba]
devu java-cleanup jdks clean [--manager sdkman|jenv|jabba] [--keep version] [--dry-run] [--yes] [--force]

devu java-cleanup builds list --root dir [--older-than-days 14]
devu java-cleanup builds clean --root dir [--older-than-days 14] [--dry-run] [--yes]
```

`--keep` (jdks) and `--root` (builds) follow the same conventions as the
other cleanup commands: `--keep` is repeatable, `--root` is required with no
implicit whole-disk scan.

## User Flow

### JDKs

1. Run `devu java-cleanup jdks list` to see installed versions and which one
   is active.
2. Run `devu java-cleanup jdks clean --dry-run` to preview what would be
   removed (everything except the active version, unless kept).
3. Run `devu java-cleanup jdks clean --keep <version>` for any additional
   versions to protect, and confirm, or pass `--yes`.

### Builds

1. Run `devu java-cleanup builds list --root ~/projects` to see every
   Maven/Gradle build output directory and its staleness.
2. Run `devu java-cleanup builds clean --root ~/projects --dry-run` to
   preview.
3. Run `devu java-cleanup builds clean --root ~/projects` and confirm, or
   pass `--yes`.

## Technical Design

- `src/commands/java-cleanup/jdk-managers.ts` — `JdkManager` interface
  (`id`, `candidatesRoot(home)`, `listInstalledVersions(home)`,
  `getActiveVersion(home)`) with three implementations:
  - **sdkman**: candidates root `~/.sdkman/candidates/java`; active version
    resolved by reading the `current` entry as a symlink and taking its
    target's basename (this is sdkman's actual mechanism — `current` is a
    real symlink to the active candidate directory).
  - **jenv**: candidates root `~/.jenv/versions`; active version read from
    the trimmed contents of `~/.jenv/version` (jenv's global-version file).
  - **jabba**: candidates root `~/.jabba/jdk`; active version read from the
    trimmed contents of `~/.jabba/version`.
  - `detectManager(home, requested?)` auto-detects by checking which
    candidates root(s) exist; throws if zero or more than one is found
    (asking for `--manager` to disambiguate), or returns the requested one
    directly if `--manager` was passed.
- `src/commands/java-cleanup/jdk-list.ts` / `jdk-clean.ts` — read-only
  listing vs. the plan → confirm → execute flow, both taking a
  `dependencies: { home?: string }` DI param (mirroring `PgInitDependencies`
  in `src/commands/pg/init.ts`) so tests never touch the real home
  directory.
- `src/commands/java-cleanup/build-finder.ts` — walks a root via the shared
  `src/shared/fs-walk.ts` walker, stopping recursion into any `target`/
  `build` directory it finds (no reason to scan generated output for nested
  projects), and requires a sibling `pom.xml` or `build.gradle`/
  `build.gradle.kts` in the *parent* of that directory before treating it as
  a real build output candidate — this is what prevents false positives on
  an unrelated directory that happens to be named `build` (e.g. a
  TypeScript project's own output directory).
- `src/commands/java-cleanup/build-list.ts` / `build-clean.ts` — same
  plan/confirm/execute shape as `node-cleanup`, reusing
  `src/shared/plan.ts` and `src/shared/dates.ts`. `build-clean.ts`
  additionally partitions stale candidates into clean/dirty via
  `hasUncommittedChanges` (`git status --porcelain`) and skips the dirty
  ones with an explicit warning rather than silently deleting or silently
  keeping them.
- `src/commands/java-cleanup/{jdk-command,build-command,command}.ts` —
  three-level subcommand dispatch (`java-cleanup` → `jdks`/`builds` →
  `list`/`clean`), following the same dispatcher pattern as
  `src/commands/pg/command.ts` and `src/commands/git-branches/command.ts`,
  nested one level deeper.

## Staleness / Selection Rules

- **JDKs**: "old" = not the active version and not passed via `--keep`.
  This intentionally does not use an age threshold — an installed JDK's
  directory mtime is not a reliable signal of whether it's in use (you can
  use a JDK for months without its install directory's mtime changing).
- **Builds**: stale = the build output directory's mtime, and (for a git
  project) its last commit time, are both older than `--older-than-days`
  (default 14) — the same "max of both signals" approach used by
  `node-cleanup` (see `src/commands/node-cleanup/finder.ts`).

## Error Handling

- Every shell/filesystem probe (`readlink`, reading a version file, listing
  a candidates directory) tolerates absence and returns `undefined`/`[]`
  rather than throwing — a manager that isn't installed, or a version file
  that doesn't exist, is a normal "unknown" state, not an error.
- `detectManager` throws a clear, actionable error for both the zero-match
  and multiple-match cases, always naming `--manager` as the way out.
- `builds list`/`builds clean` require `--root` explicitly (no implicit
  whole-disk scan), matching `node-cleanup`.

## Safety and Reviewability

This is the highest-risk command in the CLI — removing a JDK is not
something a dry-run undoes, and none of sdkman, jenv, or jabba were
available to test against on the development machine, so the manager
integrations are verified only against fabricated fixtures that mirror each
tool's documented directory layout, not real installs. That uncertainty
motivated two safety choices beyond what the other cleanup commands do:

1. **`jdks clean` refuses to run at all when the active version can't be
   determined, unless `--force` is passed.** An "unknown active version" is
   exactly the scenario where a bug in a specific manager's detection logic
   would be most dangerous (it could silently treat the actually-active JDK
   as safe to delete), so the default is to stop and ask rather than guess.
2. **A path-prefix guard runs immediately before every JDK deletion**,
   independent of the earlier active-version filtering: the resolved target
   path must be strictly inside the manager's own `candidatesRoot`, and must
   not equal the active version, or the deletion is refused for that entry
   specifically (reported as a failure, not silently skipped) rather than
   trusting the upstream selection alone.

Beyond that, this command follows the same conventions as the rest of the
CLI: `--dry-run` prints the plan and touches nothing; the full plan is
printed again immediately before the confirmation prompt; `--yes` skips the
prompt; deletion happens through `fs.rm`, never a shelled-out `rm -rf`.

`builds clean` skips (rather than deletes or silently ignores) any project
with uncommitted git changes, on the theory that a dirty working tree
suggests active work that a background cleanup tool shouldn't touch, even
though the build output itself is always regenerable.

## Cross-Platform Notes

- **`jdks`**: sdkman and jenv are not natively available on Windows
  (WSL/Cygwin only); jabba does support Windows, but rather than special-case
  one manager, `jdks list`/`jdks clean` throw a clear "not supported on
  Windows yet" error on `process.platform === "win32"` for v1.
- **`builds`**: pure Node `fs` walking plus `git`, no POSIX-only shell-outs
  — works cross-platform without special-casing.

## Test Plan

- `jdks list` shows installed versions and marks the active one (sdkman
  fixture, using a real symlink for `current`).
- `jdks clean` deletes non-active versions but keeps the active one;
  `--dry-run` deletes nothing; `--keep` protects additional versions.
- `jdks clean` refuses to run without `--force` when the active version is
  undeterminable (no `current` symlink in the fixture).
- `detectManager` throws when zero or multiple candidates roots exist, and
  `--manager` resolves the ambiguous case.
- `builds list` flags a stale Maven output directory and leaves a fresh
  Gradle one alone; ignores a `build/` directory with no sibling
  `pom.xml`/`build.gradle`.
- `builds clean --dry-run` deletes nothing; `--yes` deletes stale output but
  leaves fresh output untouched; a project with uncommitted git changes is
  skipped rather than deleted.
- `builds list`/`builds clean` require `--root`.

All of the above are implemented in `test/develop-utils.test.ts`. `jdks`
tests use fabricated fixtures (real symlinks/files shaped like each
manager's documented layout) via the `dependencies.home` override, since no
real sdkman/jenv/jabba installation was available to test against. `builds`
tests use real temporary directories and real git repositories, mirroring
the `node-cleanup` and `git-branches` test style.

## Current Delivery

`jdks list`/`clean` and `builds list`/`clean` are implemented and covered by
automated tests. Because the JDK manager integrations could only be
verified against fabricated fixtures rather than real installs, treat the
sdkman/jenv/jabba active-version detection as best-effort in production use
and prefer running `jdks list` first to sanity-check the detected active
version before running `jdks clean`.
