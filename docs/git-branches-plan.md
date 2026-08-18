# Git Branch Cleanup Design

## Product Summary

`devu git-branches` finds local git branches that have served their purpose
— merged into the default branch, or abandoned because their remote branch
was deleted — and removes them safely, with a dry-run preview and explicit
confirmation gates. A `sync` subcommand keeps the remote-tracking state
current so the "upstream gone" signal is accurate.

## Problem Statement

Local branch lists grow without bound in an active repository: every merged
feature branch, every abandoned experiment, and every branch whose PR was
closed on the remote stays checked out locally forever unless someone
remembers `git branch -d` manually. This is easy to defer, hard to do safely
by hand (which branches are actually merged? which upstreams are gone?), and
the risk of deleting the wrong branch discourages doing it at all.

## Scope

**Implemented (MVP):**

- `devu git-branches list` — read-only staleness report for local branches.
- `devu git-branches sync` — `git fetch --prune origin`, updates which
  branches show a deleted ("gone") upstream.
- `devu git-branches clean` — deletes local branches that are stale and safe
  to remove, with dry-run, confirmation, `--yes`, and `--force` gates.

**Out of scope for MVP:**

- Deleting branches on the remote (`git push origin --delete`) — this tool
  only ever touches local refs.
- Supporting remotes other than `origin`.
- A `--all-remotes` or multi-remote staleness model.

## Command Design

```bash
devu git-branches list [project-dir] [--older-than-days 90] [--protect name]
devu git-branches sync [project-dir] [--dry-run]
devu git-branches clean [project-dir] [--older-than-days 90] [--protect name] [--dry-run] [--yes] [--force]
```

`--protect` is repeatable (`--protect main --protect release`). The default
branch (detected via `refs/remotes/origin/HEAD`, falling back to the current
branch) and the currently checked-out branch are always protected, in
addition to anything passed via `--protect`.

## User Flow

1. Run `devu git-branches sync` periodically (or before cleanup) so deleted
   remote branches are reflected locally as "gone" upstreams.
2. Run `devu git-branches list` to see every local branch's status: current,
   default, merged, upstream gone, and whether it's flagged `STALE`.
3. Run `devu git-branches clean --dry-run` to preview exactly what would be
   deleted and why.
4. Run `devu git-branches clean` and confirm, or pass `--yes` to skip the
   prompt. Branches that are stale via a gone upstream but not fully merged
   require an additional `--force` to actually delete, since deleting them
   discards commits that exist nowhere else.

## Technical Design

- `src/commands/git-branches/staleness.ts` — `listLocalBranches(projectDir,
  defaultBranch)` reads `git for-each-ref refs/heads
  --format=%(refname:short)\t%(committerdate:iso-strict)\t%(upstream:track)`
  and `git branch --merged <defaultBranch> --format=%(refname:short)`, then
  builds a `BranchInfo` per local branch (`isCurrent`, `lastCommitDate`,
  `merged`, `upstreamGone`). `isStaleBranch(branch, defaultBranch,
  olderThanDays, protect)` is the single staleness predicate reused by both
  `list` and `clean` so their notion of "stale" never diverges.
- `src/commands/git-branches/list.ts` — read-only report; prints each
  branch's flags (`current`, `default`, `merged`, `upstream gone`, `STALE`).
- `src/commands/git-branches/sync.ts` — thin wrapper around `git fetch
  --prune origin`, with a `--dry-run` that only prints the command.
- `src/commands/git-branches/clean.ts` — the plan → confirm → execute →
  verify command: builds a `PlannedAction[]` (via the shared
  `src/shared/plan.ts` printer introduced for this reason) grouped by
  `Merged` vs. `Upstream gone (requires --force)`, prints it under
  `--dry-run` or before the confirmation prompt, deletes with `git branch -d`
  (merged) or `git branch -D` (gone-but-unmerged, only with `--force`), then
  re-lists branches afterward and throws if any targeted branch is still
  present (the "verify" step).
- `src/commands/git-branches/command.ts` — subcommand dispatcher, following
  the `src/commands/pg/command.ts` pattern (`list`/`sync`/`clean`, plus
  `help:list`/`help:sync`/`help:clean` aliases).
- Reuses `runGit`, `isGitRepository`, `detectDefaultBranch` from
  `src/shared/git.ts` and `confirmAction` from `src/shared/prompts.ts`
  unchanged — no new shared git plumbing was needed beyond the generic
  `PlannedAction` printer extracted in the shared-infra chore.

## Staleness Rules

A local branch is stale when **all** of the following hold:

1. It is not the current branch, not the default branch, and not named in
   `--protect`.
2. It is merged into the default branch (`git branch --merged`) **or** its
   configured upstream is gone (`%(upstream:track)` reports `[gone]`).
3. Its last commit is older than `--older-than-days` (default 90).

## Error Handling

- `runGit` already swallows git errors and returns a fallback (empty string)
  rather than throwing, so a missing/unresolvable default branch (e.g. no
  local branch matching the detected default) degrades to an empty merged
  set instead of crashing — `clean`/`list` just report those branches as not
  merged.
- Commands validate `isGitRepository(projectDir)` up front and throw a clear
  `Error` (not a raw git stderr dump) when the target isn't a repository.
- `clean`'s post-delete verification step throws if `git branch -d`/`-D`
  silently failed to remove a branch it should have, rather than reporting
  success incorrectly.

## Safety and Reviewability

- Nothing is deleted under `--dry-run`; the plan is printed and the process
  exits.
- Every deletion is confirmed interactively unless `--yes` is passed, and the
  full list of branches (with reasons) is printed immediately before the
  prompt.
- Gone-but-unmerged branches are the one irreversible case (their commits
  may exist nowhere else) and require the additional `--force` flag on top
  of `--yes`, mirroring `pg init`'s `--yes`+`--force` gate for overwriting an
  existing `DATABASE_URL`.
- The current branch, the default branch, and any `--protect`ed name can
  never be deleted, regardless of flags.
- `sync` only ever touches remote-tracking refs (`refs/remotes/origin/*`); it
  never deletes a local branch.

## Test Plan

- `list` flags a merged, old branch as `STALE` and leaves a recent unmerged
  branch alone.
- `clean --dry-run` prints the plan and deletes nothing.
- `clean --yes` deletes a merged stale branch.
- `clean --yes` skips a stale-via-gone-upstream branch that isn't fully
  merged; `clean --yes --force` deletes it.
- `clean --yes --protect <name>` (and the current/default branch) are never
  deleted even when otherwise stale.
- `sync` fetches and prunes a remote-tracking ref for a branch deleted on a
  real (local bare) remote; `sync --dry-run` does not fetch.
- `list`/`clean`/`sync` reject a target directory that is not a git
  repository.

All of the above are implemented in `test/develop-utils.test.ts` using real
temporary git repositories (and a temporary bare repo as `origin` for the
sync/gone-upstream cases) rather than mocked git — this command's entire
surface area is git plumbing, so exercising real `git` end-to-end is more
representative than faking it.

## Current Delivery

`list`, `sync`, and `clean` are implemented and covered by automated tests.
Remote branch deletion and multi-remote support remain out of scope.
