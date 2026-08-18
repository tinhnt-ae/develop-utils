# Repository Audit

## Audit record

| Field | Value |
| --- | --- |
| Audit date | 2026-07-27 (Asia/Ho_Chi_Minh) |
| Repository | `tinhnt-ae/develop-utils` |
| Branch | `fix/cannot-deploy-package-to-npm` |
| Starting commit | `c019eccf5038661ba167b69bf506e88e0cdf6cda` |
| Package | `devu-utils@1.1.6` |
| Primary command | `devu` |
| Compatibility alias | `develop-utils` |
| Local runtime | Node.js `20.19.4`, npm `10.8.2` |
| Declared runtime | Node.js `>=22` |
| Initial worktree | Clean |
| Scope | Correctness, maintainability, security, tests, npm packaging, release readiness, documentation, and developer experience |

This document is the persistent audit and remediation tracker. The audit did
not change application code, tests, workflows, package metadata, or release
configuration.

## Status legend

| Status | Meaning |
| --- | --- |
| Pending | Not evaluated yet |
| Pass | Evaluated with no actionable finding |
| Finding | Actionable issue identified; remediation is not yet approved |
| Blocked | Verification could not be completed with the available safe prerequisites |
| Accepted | The owner reviewed and accepted the result or residual risk |
| Remediated | The authorised fix is implemented and supported by regression and verification evidence |

## Executive summary

The package builds and packs successfully, its published binaries are
executable, the CLI help and all three dry-run paths work, and static scanning
found no committed high-confidence secrets or shell-string execution. The
release configuration consistently targets `main`, npm Trusted Publishing, and
the package's local semantic-release dependencies.

The repository is not currently release-ready. `npm test` fails one of 25
tests, while the only GitHub Actions workflow can publish without running the
test suite. PostgreSQL provisioning also has two high-impact issues: validation
can occur after a password mutation, and a complete credential-bearing
`DATABASE_URL` is printed to stdout. The dependency audit reports one high and
nine moderate vulnerabilities.

Findings: **0 critical, 5 high, 3 medium, and 3 low**. Live PostgreSQL mutation
against a real container remains blocked because no disposable audit container
was available and modifying the unrelated running project database was outside
the audit boundary.

## Findings

| ID | Severity | Category | Evidence | Impact | Recommendation | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AUD-001 | High | Tests | Original evidence: `npm test` ran 25 tests and failed because the PostgreSQL dry-run test asserted the stale complete phrase `Inspect running PostgreSQL-compatible containers`. Remediation: the test now checks inspection, validation, the requested container, database, role, env destination, and redacted connection output as separate stable semantics. Independent assertions prove dry-run invokes no Docker or PostgreSQL execution, password generation, env-file write, or filesystem mutation. | The test suite once could not distinguish regressions from known wording drift; it now verifies the durable dry-run contract. | Keep the behavioural assertions independent of complete human-readable prose and run the full suite on the supported CI runtime. | Remediated |
| AUD-002 | High | Release safety | Original evidence: `.github/workflows/release.yml` could invoke semantic-release after only `npm ci`. Remediation: the committed and generated GitHub workflows now require a read-only Node 24 validation job running `npm ci`, build, all tests, and package dry-run; release has `needs: validation`. Generated GitLab and Bitbucket pipelines place release after equivalent validation. | Failed build, test, or package construction now prevents the publishing stage from starting in every generated provider pipeline. | Preserve the canonical workflow gate and regression tests that reject missing validation, missing commands, misplaced semantic-release, missing dependency, and `if: always()`. | Remediated |
| AUD-003 | High | PostgreSQL correctness | Original evidence: `provisionPostgres` created or altered the project role before checking database ownership, and the owner-mismatch test did not reject `ALTER ROLE`. Remediation: `src/commands/pg/postgres.ts` now separates read-only inspection, complete validation, a frozen password-free execution plan, deterministic mutation, and read-only verification. Tests prove owner mismatch and inspection failure execute none of `CREATE ROLE`, `ALTER ROLE`, `CREATE DATABASE`, `ALTER DATABASE`, `GRANT`, `REVOKE`, `ALTER SCHEMA`, or `CREATE SCHEMA`. Disposable-container verification also proved password, database ACL/owner, and schema ACL/owner were unchanged after mismatch rejection. | A rejected incompatible database no longer rotates a role password or partially changes grants/ownership. | Read and validate both role state and database ownership before any mutation. Add a regression test proving owner mismatch emits no `CREATE ROLE`, `ALTER ROLE`, `CREATE DATABASE`, grant, or schema statements. | Remediated |
| AUD-004 | High | Credential handling | Original evidence: `src/commands/pg/init.ts` printed the complete `DATABASE_URL`. Remediation: output now prints only a `***` connection URL and the protected env destination; `psql` stderr is captured and replaced with a credential-free phase error. Tests use `ProvidedSecret-DoNotPrint-123` and `GeneratedSecret-DoNotPrint-456` across success, validation, inspection, and child-process failure paths, while verifying the real value exists only in the mode-`0600` env file or SQL stdin. | Generated and user-provided passwords no longer reach CLI stdout, stderr, summaries, prompts, or exposed child diagnostics. | Never print the complete URL. Report only the destination file and a redacted connection summary; add tests that stdout and stderr never contain provided or generated passwords. | Remediated |
| AUD-005 | High | Dependencies | Live `npm audit --json` reported 10 vulnerabilities: 1 high (`brace-expansion`) and 9 moderate across `tar`, npm, semantic-release, and semantic-release plugins. npm proposes major-version downgrades for several direct dependencies, so automatic force-fixing is unsafe. | Release tooling processes repository and package data; vulnerable transitive tooling increases denial-of-service and supply-chain exposure. | Investigate current patched versions and lockfile resolution, update the release toolchain without `npm audit fix --force`, then rerun tests, packaging, and audit. Document any advisory accepted as dev-only residual risk. | Finding |
| AUD-006 | Medium | Runtime contract | `package.json` permits Node.js `>=22`, but `add-semantic-release` rejects non-dry-run local mode below Node.js `22.14.0`. The audit host is Node.js 20, so the supported minimum was not exercised locally. | Users on Node.js 22.0-22.13 can install the package successfully and then encounter a command-level runtime rejection. | Set the package engine and README prerequisite to the true minimum (`>=22.14.0`) or lower the command requirement if supported; validate at the minimum and CI version. | Finding |
| AUD-007 | Medium | Reliability | Shared Git, Docker, and `psql` subprocesses use synchronous execution without timeouts. Only the separate `npm view` call has a 10-second timeout. | A stalled Docker daemon, Git credential helper, or PostgreSQL command can hang the CLI indefinitely. | Add command-specific timeouts and actionable timeout errors, with tests using a deliberately stalled fake executable. | Finding |
| AUD-008 | Medium | Audit packaging | `package.json` publishes the entire `docs/` directory. Therefore this tracker will be included in the next npm package unless the published file policy changes. | Internal remediation details and historical findings become part of the public package and increase package noise. | Decide during remediation whether the audit is intentionally public. If not, use explicit documentation entries in `files` or move operational audit records outside published paths. | Finding |
| AUD-009 | Low | Product metadata | `package.json` describes only license and semantic-release utilities, and `FEATURE.md` lists only those two commands. `devu pg init` is implemented and documented in the README. | npm search results and feature rationale understate the current package capability. | Update the package description and `FEATURE.md` to include PostgreSQL provisioning and its existing-container safety boundary. | Finding |
| AUD-010 | Low | Package contents | semantic-release maintains `CHANGELOG.md`, but the dry-run package contained 85 entries and excluded the changelog because it is not in `files`. | npm consumers cannot inspect release history from the installed package, despite the project maintaining it. | Add `CHANGELOG.md` to published files if installed-package release history is desired; otherwise explicitly document that history is available only through GitHub. | Finding |
| AUD-011 | Low | Supply-chain hardening | The release workflow references `actions/checkout@v5` and `actions/setup-node@v5` by mutable major tags. | A compromised or unexpectedly moved action tag could affect a privileged publishing workflow. | Pin actions to reviewed commit SHAs and use dependency automation to propose controlled updates. | Finding |

## Remediation evidence — AUD-003 and AUD-004

Remediation completed on 2026-07-27 without a commit. Files changed were
`src/commands/pg/postgres.ts`, `src/commands/pg/init.ts`, and
`test/develop-utils.test.ts`; this tracker was updated in place. No files were
created or deleted by the remediation. The pre-existing stale AUD-001 dry-run
wording assertion was changed only as required to exercise the authorised
PostgreSQL tests; AUD-001 remains outside this remediation slice.

Verification results:

- `npm test`: passed all 30 tests on local Node.js 20.19.4. This is not a claim
  of supported-runtime verification because `package.json` declares Node.js
  22 or newer.
- `npm run build`: passed.
- `NPM_CONFIG_CACHE=/private/tmp/develop-utils-npm-cache npm run pack:dry-run`:
  passed with 86 packaged files.
- `git diff --check`: passed.
- `node dist/cli/develop-utils.js pg init . --container audit-postgres --dry-run`:
  passed without Docker, SQL, password generation, or file mutation.
- Disposable `postgres:16` container `devu-audit-pg-20260727`: fresh
  provisioning, safe reuse, and incompatible-owner rejection passed. Boolean
  state comparisons proved the mismatched role password, database ACL/owner,
  and public-schema ACL/owner were unchanged. The new env file was mode `0600`.
  The disposable container and temporary directories were removed afterward;
  `ledgerbase-postgres` was not used or modified.

AUD-003 and AUD-004 are therefore `Remediated`. All other finding statuses are
unchanged.

## Remediation evidence — AUD-001 and AUD-002

Remediation completed on 2026-07-27 without a commit. The PostgreSQL dry-run
regression now uses multiple stable assertions rather than the original stale
sentence. It checks the requested container, derived database and role,
environment-file destination, masked connection, planned inspection and
validation, and the absence of Docker, PostgreSQL, password-generation, and
filesystem side effects. All existing R1 owner-mismatch, redaction, dry-run
isolation, and protected-env tests remain present and green.

Release validation is canonicalized through
`src/commands/add-semantic-release/workflows.ts`; a regression test requires the
committed `.github/workflows/release.yml` to equal its generated npm/GitHub
form. GitHub scopes `contents: read` to validation and keeps write/OIDC
permissions on release, which has `needs: validation`. GitLab uses ordered
`validate` and `release` stages. Bitbucket uses sequential Validate and Release
steps. Each validation path uses Node.js 24 and runs `npm ci`, `npm run build`,
`npm test`, and `npm run pack:dry-run`; semantic-release appears only afterward.

Negative in-memory variants prove the safety contract rejects a missing
validation job, build, tests, package verification, or GitHub dependency, as
well as semantic-release in validation and `if: always()`. The post-change
publication search found no other publish-capable workflow. The related
dependency-install-before-file-write partial-state behavior remains deferred;
it does not bypass validation and is outside R2's merge/redesign boundary.

Verification results:

- Local Node.js 20.19.4/npm 10.8.2: build and all 33 tests passed. This local
  result is not used as supported-runtime evidence.
- Disposable `node:24@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059`:
  Node.js 24.18.0/npm 11.16.0; `npm ci`, build, all 33 tests, and package dry-run
  passed. The dry-run constructed an 86-file package. The repository mount was
  read-only and the disposable container was removed automatically.
- Workflow validation tool: not run. Reason: `actionlint` is not available.
  Alternative evidence: canonical-output comparison, provider regression tests,
  negative workflow variants, and structural inspection.

AUD-001 and AUD-002 are therefore `Remediated`. AUD-003 and AUD-004 remain
`Remediated`; AUD-005 through AUD-011 are unchanged.

## Area assessment

| Area | Status | Evidence and conclusion |
| --- | --- | --- |
| CLI routing and arguments | Pass | `devu` routes all three command families, rejects unknown options/commands, supports command help, and retains `develop-utils`. Common argument parsing is strict, although it accepts feature-irrelevant shared options; no user-impacting defect was demonstrated. |
| Prompt and write approval | Pass | License and semantic-release writes are approved individually; PostgreSQL requires provisioning and env-file approval or explicit automation flags. Tests cover decline paths and existing env protection. |
| Dry-run guarantees | Pass | All three smoke runs completed without tracked changes. PostgreSQL dry-run returns before Docker inspection, password generation, SQL, and file writes. |
| Filesystem handling | Pass | New PostgreSQL env files use exclusive creation and mode `0600`; existing env values require confirmation or `--yes --force`. General generated text files are not atomic, but no concrete data-loss reproduction was performed in this audit. |
| Subprocess safety | Pass | Commands use argument arrays through `execFileSync`; no `shell: true`, `eval`, or `new Function` was found. PostgreSQL identifiers and literals are validated/escaped before SQL is sent through stdin. Timeout coverage is tracked in AUD-007. |
| PostgreSQL isolation | Finding | Role privilege and database-owner protections exist, and lifecycle commands never create/start/stop/remove containers. Mutation ordering and credential output require remediation (AUD-003 and AUD-004). |
| TypeScript structure | Pass | Strict NodeNext TypeScript is separated into CLI, feature command, and shared modules. Published declarations and declaration maps build successfully. The single large semantic-release command is a future refactor candidate, not a demonstrated defect. |
| Test coverage | Pass | All 33 tests pass locally and on Node.js 24. Stable PostgreSQL dry-run and sensitive-output assertions remain covered; release workflow tests cover canonical committed output, all generated providers, and unsafe negative variants. |
| Dependency and secret safety | Finding | High-confidence static secret patterns returned no matches. `npm audit` returned one high and nine moderate advisories (AUD-005). |
| npm packaging | Finding | Build, pack, executable modes, bin mappings, ESM output, README, license, and public access metadata passed. Audit-document and changelog publication policy need decisions (AUD-008 and AUD-010). |
| Release configuration | Pass | `package.json`, `.releaserc.json`, and the workflow agree on semantic-release/npm, GitHub, `main`, Node 24, and OIDC permission. Build, tests, and package construction gate release. Trusted Publisher settings on npmjs.com remain external and were not verified. |
| Documentation and DX | Finding | README installation, global `devu`, one-off npx, aliases, and current command usage match implementation. Runtime minimum and secondary metadata drift remain (AUD-006 and AUD-009). |
| Live Docker/PostgreSQL integration | Blocked | Docker 29.4.0 is available, but the only running PostgreSQL container is `ledgerbase-postgres` (`postgres:16`). It belongs to another project; the audit did not mutate it and no disposable audit container was authorized. Fake-Docker integration tests exercised command construction and state handling. |

## Verification evidence

| Command or check | Result | Status |
| --- | --- | --- |
| `npm test` | Build and test compilation succeeded; 25 tests ran, 24 passed, 1 failed due to the dry-run wording assertion in AUD-001. | Finding |
| `npm pack --dry-run --json` | Succeeded for `devu-utils@1.1.6`: 85 entries, 29,620-byte archive, 103,408 bytes unpacked. All four configured bin targets were present; CLI JavaScript files had executable mode `0755`. | Pass |
| `npm audit --json` | Registry request completed after network access was granted. Result: 0 critical, 1 high, 9 moderate, 0 low. | Finding |
| `git diff --check` before report creation | Passed with no whitespace errors. | Pass |
| CLI help smoke tests | `devu --help` plus help for `add-licenses`, `add-semantic-release`, and `pg init` all exited successfully and matched the documented primary command. | Pass |
| `devu add-licenses . --dry-run` | Planned four files and produced no tracked changes. | Pass |
| `devu add-semantic-release . --dry-run` | Planned dependency/config/workflow/package changes and produced no tracked changes; warned that local Node 20.19.4 is below 22.14.0. | Pass |
| `devu pg init . --container audit-postgres --dry-run` | Printed Docker, SQL, and env-file plan with a masked password and returned before Docker access or writes. | Pass |
| Packed-file and bin inspection | `devu`, `develop-utils`, `add-licenses`, and `add-semantic-release` resolve to present compiled CLI files. Package name and README use `devu-utils`; `devu` is consistently primary. | Pass |
| Static secret scan | No matches for private-key headers, common GitHub/npm token forms, or AWS access-key IDs outside ignored dependencies/build outputs. | Pass |
| Risky subprocess scan | No shell-string execution, `shell: true`, `eval`, or dynamic function construction. All production child processes use argument arrays. | Pass |
| Release configuration comparison | Branch, plugins, npm publishing, GitHub token, OIDC permission, and Node 24 usage are internally consistent. No validation step exists before release. | Finding |
| Docker environment inspection | Docker daemon responded with version 29.4.0; one unrelated healthy PostgreSQL 16 container was present. No live provisioning was performed. | Blocked |

## Prioritized remediation backlog

### Critical

No critical findings.

### High

1. **AUD-003:** Move all PostgreSQL compatibility/ownership validation before
   role or database mutation and add a zero-mutation regression test.
2. **AUD-004:** Remove credential-bearing URL output and add secret-redaction
   tests.
3. **AUD-001:** Repair the stale dry-run assertion and restore a green suite.
4. **AUD-002:** Gate semantic-release on tests and package verification.
5. **AUD-005:** Resolve or explicitly accept dependency advisories without
   force-downgrading the release stack.

### Medium

1. **AUD-006:** Make the package engine, README, and command runtime requirement
   consistent, then test the declared minimum.
2. **AUD-007:** Add bounded subprocess execution and timeout diagnostics.
3. **AUD-008:** Decide whether this audit tracker belongs in the public npm
   artifact and narrow the published documentation list if necessary.

### Low

1. **AUD-009:** Align npm metadata and feature rationale with `devu pg init`.
2. **AUD-010:** Decide whether to publish `CHANGELOG.md`.
3. **AUD-011:** Pin privileged GitHub Actions to commit SHAs.

## Approval boundary

The audit is complete. All findings remain in `Finding` status and no
remediation is authorized by this document. Before implementation, approve a
specific remediation slice by finding ID. The recommended first slice is
AUD-003 and AUD-004 together because both affect PostgreSQL safety and require
coordinated regression tests.
