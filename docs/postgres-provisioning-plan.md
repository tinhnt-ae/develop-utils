# PostgreSQL Local Provisioning Plan

## Product Summary

`develop-utils pg init` helps developers share one local PostgreSQL container
across many projects while keeping each project isolated with its own database,
role, password, and permissions.

This belongs in `develop-utils` because it matches the product position:
repeatable setup automation that makes decisions visible, reviewable, and safe.
Instead of copying stale Docker Compose files into every repo, the CLI should
guide the developer through a predictable local database setup and show exactly
what it will create.

Correct model:

```text
One shared PostgreSQL container
  - ledgerbase_dev + ledgerbase_user
  - portfolio_dev + portfolio_user
  - story_audio_dev + story_audio_user
```

Incorrect model:

```text
One shared database used by every project
```

The CLI reuses the PostgreSQL container. It does not reuse the same database.

## Problem Statement

Developers often maintain many local projects that need PostgreSQL. The usual
copy-paste Docker Compose approach causes:

- duplicated PostgreSQL containers
- repeated Docker Compose files
- port conflicts on `5432`
- stale volumes with forgotten data
- forgotten local credentials
- slow setup for side projects, MVPs, and experiments
- unclear ownership of which container belongs to which project

The CLI should remove this repeated setup work while preserving isolation at the
database and role level.

## Scope

Implemented scope:

- `pg init`
- validation of a named, running PostgreSQL-compatible container
- database, user, password, and permission provisioning
- `.env.local` writing
- `--dry-run`

Out of scope for MVP:

- dropping databases
- resetting databases
- migrations
- backups
- production deployment
- CI database lifecycle
- multi-database engine support
- PostgreSQL container creation or lifecycle management

## Command Design

MVP command:

```bash
devu pg init
```

Options:

```bash
devu pg init --dry-run
devu pg init --yes
devu pg init --env .env.local
devu pg init --project ledgerbase
devu pg init --database ledgerbase_dev
devu pg init --user ledgerbase_user
devu pg init --password auto
devu pg init --container local-postgres
devu pg init --force
```

Run without installing:

```bash
npx --package devu-utils devu pg init --dry-run
```

Later commands:

```bash
npx develop-utils pg list
npx develop-utils pg create
npx develop-utils pg url
npx develop-utils pg status
```

`pg list` should list detected PostgreSQL containers and known project databases
when credentials are available.

## User Flow

Example:

```text
$ devu pg init

Found PostgreSQL containers:
1. local-postgres
   image: postgres:16
   port: 5432 -> 5432

Use this container? yes
Project name: ledgerbase
Database name: ledgerbase_dev
Database user: ledgerbase_user
Password: auto-generate

Created database: ledgerbase_dev
Created user: ledgerbase_user
Granted privileges.

DATABASE_URL:
postgresql://ledgerbase_user:******@shared-postgres:5432/ledgerbase_dev

Write DATABASE_URL to .env.local? yes
```

Step-by-step behavior:

1. Check whether Docker is installed and reachable.
2. Inspect the named existing PostgreSQL-compatible container.
3. Stop if the container is missing, stopped, incompatible, or not ready.
4. Never create, start, stop, or remove a container.
5. Resolve the admin role from `--admin-user`, `POSTGRES_USER`, or `postgres`.
6. Ask for project name.
7. Generate a safe default database name from project name.
8. Generate a safe default database user from project name.
9. Generate a password or allow the user to provide one.
10. Connect to PostgreSQL as an admin role.
11. Check whether the database already exists.
12. Check whether the role already exists.
13. Create the role if missing.
14. Create the database if missing.
15. Assign database ownership and permissions to the project role.
16. Print the generated `DATABASE_URL`.
17. Ask whether to write it to `.env.local`.
18. Never overwrite existing `.env.local` values without explicit confirmation.
19. Support `--dry-run`.
20. Default the connection host to the container name for cross-container use.

## Technical Design

Target module layout:

```text
src/
  commands/
    pg/
      init.ts
      list.ts
      create.ts
      url.ts
      status.ts
  core/
    docker.ts
    postgres.ts
    env-file.ts
    naming.ts
    prompts.ts
    logger.ts
    dry-run.ts
```

### `docker.ts`

Responsibilities:

- check Docker CLI availability
- check Docker daemon reachability
- inspect and validate the named PostgreSQL-compatible container
- check PostgreSQL readiness
- execute commands inside the selected container

Functions:

```ts
inspectPostgresContainer(name: string, requestedAdminUser?: string): PostgresContainer
```

### `postgres.ts`

Responsibilities:

- verify PostgreSQL readiness
- run admin SQL
- check and create roles/databases
- grant privileges
- build URLs

Functions:

```ts
checkPostgresReady(connection): Promise<boolean>
databaseExists(connection, databaseName: string): Promise<boolean>
roleExists(connection, roleName: string): Promise<boolean>
createRole(connection, roleName: string, password: string): Promise<void>
createDatabase(connection, databaseName: string, ownerRole: string): Promise<void>
grantPrivileges(connection, databaseName: string, roleName: string): Promise<void>
buildDatabaseUrl(options): string
```

### `naming.ts`

Responsibilities:

- normalize project names
- produce PostgreSQL-safe identifiers
- cap identifier length safely
- avoid invalid leading characters

Functions:

```ts
normalizeProjectName(input: string): string
buildDatabaseName(projectName: string): string
buildUserName(projectName: string): string
```

Example:

```text
Ledger Base API -> ledger_base_api
database -> ledger_base_api_dev
user -> ledger_base_api_user
```

### `env-file.ts`

Responsibilities:

- read `.env`-style files without losing unrelated keys
- detect existing keys
- append or update values with confirmation
- preserve newline behavior

Functions:

```ts
readEnvFile(filePath: string): Promise<EnvFile>
hasEnvKey(envFile: EnvFile, key: string): boolean
writeEnvValue(filePath: string, key: string, value: string): Promise<void>
updateEnvValueWithConfirmation(filePath, key, value, options): Promise<void>
```

### `dry-run.ts`

Responsibilities:

- collect planned mutating actions
- print actions in execution order
- ensure mutating modules can be called in preview mode

Functions:

```ts
collectPlannedActions(): PlannedAction[]
printPlannedActions(actions: PlannedAction[]): void
```

## PostgreSQL SQL Strategy

Use identifier quoting helpers for database and role names. Use parameterized or
escaped string handling for passwords.

Role creation:

```sql
CREATE USER ledgerbase_user WITH PASSWORD '...';
```

Database creation:

```sql
CREATE DATABASE ledgerbase_dev OWNER ledgerbase_user;
```

Database grants:

```sql
GRANT ALL PRIVILEGES ON DATABASE ledgerbase_dev TO ledgerbase_user;
```

PostgreSQL 15+ schema privileges:

```sql
GRANT ALL ON SCHEMA public TO ledgerbase_user;
ALTER SCHEMA public OWNER TO ledgerbase_user;
```

Execution rules:

- Run role existence checks before `CREATE USER`.
- Run database existence checks before `CREATE DATABASE`.
- Run database-level grants after the database exists.
- Run schema grants by connecting to the project database, not the admin database.
- Treat existing database/role as non-fatal if they match the requested names.
- Never drop or reset anything in MVP.

## Container Detection Strategy

Start simple:

```bash
docker ps --format '{{.ID}} {{.Image}} {{.Names}} {{.Ports}}'
```

Detect images containing:

- `postgres`
- `postgresql`
- `postgis`
- `timescale`

Also inspect:

- exposed host port for container port `5432`
- container env vars such as `POSTGRES_USER`
- readiness with `pg_isready` inside the container

Example readiness command:

```bash
docker exec <container> pg_isready -U <admin-user>
```

Container creation is intentionally unsupported. If the requested container is
missing or stopped, the command reports that condition and exits without changes.
blindly.

## Error Handling

Expected errors and messages:

- Docker not installed: "Docker CLI was not found. Install Docker Desktop or Docker Engine and rerun this command."
- Docker daemon not running: "Docker is installed, but the daemon is not reachable."
- No container found: "No running PostgreSQL containers were found. Create a shared local PostgreSQL container?"
- Selected container is not reachable: "The selected container did not respond to pg_isready."
- Invalid credentials: "Could not connect as the admin PostgreSQL user. Check container credentials."
- Database already exists: "Database already exists; leaving it unchanged."
- User already exists: "Role already exists; leaving it unchanged unless permissions are missing."
- `.env.local` already has `DATABASE_URL`: "DATABASE_URL already exists. Overwrite it?"
- Port `5432` already in use: "Port 5432 is already in use. Choose another host port or reuse the existing container."
- Permission denied: "The admin role does not have permission to create roles or databases."
- Unsupported container image: "This container does not look PostgreSQL-compatible."

## Safety and Reviewability

Every mutating command should support:

```text
--dry-run  show what would change, write nothing
--yes      accept safe defaults
--force    allow overwrite where explicitly supported
```

Behavior:

- Default behavior is conservative and interactive.
- `--dry-run` prints planned Docker, SQL, and file actions without executing them.
- `--yes` can accept safe defaults, but must not overwrite existing env values.
- `--force` can overwrite supported values only when paired with explicit flags.
- The CLI must never silently overwrite `.env.local` values.
- The CLI must warn that a shared container is not recommended when:
  - the project needs a different PostgreSQL version
  - the project needs special extensions such as PostGIS or TimescaleDB
  - the project tests destructive migrations
  - the project needs production-like infrastructure
  - the project runs in CI
  - the project has strict isolation requirements

## Feature Tasks

### Task 1: Add `pg` Command Group

Context:
The current CLI has standalone command wiring. Add a grouped `pg` surface without
breaking existing commands.

Implementation:

- Add `src/commands/pg/init.ts`.
- Add placeholder modules for `list`, `create`, `url`, and `status`.
- Route `devu pg init` and `develop-utils pg init` through the existing CLI.
- Add help text for `pg`.

Acceptance Criteria:

- `devu pg --help` shows available pg commands.
- `devu pg init --dry-run` reaches the init handler.
- Existing commands still work.

Testing:

- CLI tests for routing.
- Help output snapshot-style assertions.

### Task 2: Add Naming Utilities

Context:
PostgreSQL identifiers need predictable safe names.

Implementation:

- Implement `normalizeProjectName`.
- Implement `buildDatabaseName`.
- Implement `buildUserName`.
- Enforce lowercase snake case.
- Trim repeated underscores.
- Cap names below PostgreSQL's 63-byte identifier limit.

Acceptance Criteria:

- `ledgerbase` -> `ledgerbase_dev`, `ledgerbase_user`.
- `Story Audio` -> `story_audio_dev`, `story_audio_user`.
- Invalid characters are removed or converted safely.

Testing:

- Unit tests for spaces, hyphens, uppercase, punctuation, and long names.

### Task 3: Add Dry-Run Action Model

Context:
`pg init` will touch Docker, PostgreSQL, and `.env.local`; preview must be clear.

Implementation:

- Add `PlannedAction` type.
- Add action collector.
- Print planned actions grouped by Docker, PostgreSQL, and files.

Acceptance Criteria:

- `--dry-run` writes nothing.
- Output includes proposed container, database, role, grants, and env file changes.

Testing:

- Unit tests for action collection and formatting.

### Task 4: Docker Availability and Container Validation

Context:
The command validates the existing PostgreSQL container named by the user.

Implementation:

- Implement Docker CLI check.
- Implement daemon check with `docker info`.
- Inspect its state, image, and environment.
- Add `pg_isready` readiness check.

Acceptance Criteria:

- Docker missing and daemon stopped show separate messages.
- A running compatible PostgreSQL container is accepted.
- Missing, stopped, and incompatible containers fail without mutation.

Testing:

- Unit tests for `docker ps` parsing.
- Integration test behind an opt-in Docker flag.

### Task 5: Existing Container Validation

The implemented command checks Docker availability, inspects the requested
container, validates its image and running state, resolves its admin role, and
checks readiness with `pg_isready`. It never performs container lifecycle changes.

### Task 6: PostgreSQL Provisioning

Context:
The CLI needs idempotent role/database setup.

Implementation:

- Connect as admin.
- Check role existence.
- Check database existence.
- Create missing role.
- Create missing database.
- Grant database privileges.
- Connect to project database and grant schema privileges.

Acceptance Criteria:

- First run creates role/database.
- Second run reports existing resources and succeeds.
- Generated `DATABASE_URL` connects as the project role.

Testing:

- Integration test against disposable PostgreSQL container.
- Rerun idempotency test.

### Task 7: `.env.local` Support

Context:
The CLI should help write `DATABASE_URL` without overwriting user values.

Implementation:

- Add env file parser/writer.
- Append `DATABASE_URL` when missing.
- Prompt before replacing existing `DATABASE_URL`.
- Support `--env <path>`.

Acceptance Criteria:

- Missing file is created after confirmation.
- Existing unrelated keys are preserved.
- Existing `DATABASE_URL` is never overwritten silently.

Testing:

- Unit tests for create, append, preserve, overwrite decline, and overwrite confirm.

### Task 8: `pg list`

Context:
Users need visibility into shared containers.

Implementation:

- List PostgreSQL-compatible containers.
- Show image, name, ID, ports, and readiness.
- If admin credentials are known, list project databases matching `_dev`.

Acceptance Criteria:

- `devu pg list` works without mutating state.
- Output distinguishes ready and not-ready containers.

Testing:

- Unit tests for formatting.
- Optional Docker integration test.

### Task 9: Doctor Integration

Context:
`doctor` should explain local PostgreSQL setup health.

Implementation:

- Check Docker reachability.
- Check PostgreSQL container presence.
- Check readiness.
- Check `.env.local` for `DATABASE_URL`.
- Optionally test the URL connection.

Acceptance Criteria:

- `doctor` reports pass/warn/fail statuses.
- Missing Docker is a clear actionable failure.

Testing:

- Unit tests for report status mapping.
- Integration tests behind Docker flag.

## Suggested Implementation Order

Phase 1:

- CLI command group
- naming utilities
- dry-run infrastructure

Phase 2:

- Docker availability
- existing-container validation

Phase 3:

- PostgreSQL connection
- SQL provisioning
- URL generation

Phase 4:

- `.env.local` read/write support
- overwrite confirmations

Phase 5:

- `pg list`
- `doctor` integration
- integration tests

## Test Plan

Unit tests:

- project name normalization
- database name generation
- username generation
- container state/image/admin-user validation
- env file update behavior
- dry-run action collection
- SQL statement construction

Integration tests:

- Docker available
- create database
- create user
- connect with generated `DATABASE_URL`
- rerun command safely when database/user already exists
- `.env.local` write with existing key

Integration tests should be opt-in with an environment flag such as:

```bash
DEVELOP_UTILS_DOCKER_TESTS=1 npm test
```

## Doctor Integration

`devu doctor` should eventually check:

- Docker CLI is installed
- Docker daemon is reachable
- at least one PostgreSQL-compatible container exists
- selected PostgreSQL container is healthy
- `.env.local` contains `DATABASE_URL`
- `DATABASE_URL` is reachable
- shared-container warnings are visible when applicable

Doctor should not create or mutate resources. It only reports status and next
commands.

## Current Delivery

`pg init` routing, preview, existing-container validation, idempotent role and
database provisioning, grants, password handling, and safe env-file updates are
implemented. Container creation remains deliberately unsupported. `pg list`,
`pg status`, and `doctor` remain possible follow-up commands rather than part of
`pg init` completion.
