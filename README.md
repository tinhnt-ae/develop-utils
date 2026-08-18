# develop-utils

`develop-utils` is a command-line toolkit for repeatable repository setup and
local development tasks. The npm package is named `devu-utils`, and its primary
command is `devu`.

Use it to:

- generate license, copyright, authorship, and line-ending policy files;
- add semantic-release configuration and CI workflows;
- provision a project-specific database and role in an existing PostgreSQL
  Docker container;
- list, clean up, and sync outdated local git branches;
- find and stop the process listening on a TCP port; and
- list and delete stale `node_modules` directories to reclaim disk space.

## Requirements

- Node.js 22 or newer
- Git for repository metadata and release setup
- Docker only when using `devu pg init`
- `lsof` (macOS/Linux) or `netstat` (Windows) only when using `devu ports`

## Recommended installation

Install the package globally once so that `devu` is available from any
directory:

```bash
npm install --global devu-utils
```

Confirm that the command is available:

```bash
devu --help
```

You can now run any command directly:

```bash
devu add-licenses --dry-run
devu add-semantic-release --dry-run
devu pg init --container existing-postgres --dry-run
devu git-branches list
devu ports list --port 3000
devu node-cleanup list --root ~/projects
```

To update a global installation later:

```bash
npm install --global devu-utils@latest
```

### Run without a global installation

Use `npx` if you only need the tool once or do not want to install it globally:

```bash
npx --package devu-utils -- devu add-licenses --dry-run
```

> The package name is `devu-utils`, not `devu`. Installing a package named
> `devu` will install a different package.

## Quick start

Run a preview from the repository you want to configure:

```bash
cd path/to/your-project
devu add-licenses --dry-run
```

If the preview is correct, run the command without `--dry-run`. Commands ask
for confirmation before creating or replacing protected files.

```bash
devu add-licenses
```

Pass a project directory when you do not want to change directories first:

```bash
devu add-licenses ./my-project --dry-run
```

## Commands

### `devu add-licenses`

Creates repository ownership and license files using metadata from Git:

- `LICENSE`
- `COPYRIGHT.md`
- `AUTHORSHIP.md`
- `.gitattributes`

```bash
devu add-licenses [project-dir] [--project-name name] [--dry-run]
```

Metadata defaults:

- owner name: `git config user.name`
- owner email: `git config user.email`
- repository URL: `git remote get-url origin`
- GitHub username: parsed from the origin URL when possible
- project start date: first commit date, falling back to today

Override identity values with environment variables when needed:

```bash
DEVELOP_UTILS_FULL_NAME="Your Legal Name" \
DEVELOP_UTILS_EMAIL="you@example.com" \
DEVELOP_UTILS_GITHUB_USERNAME="your-github-user" \
devu add-licenses --dry-run
```

### `devu add-semantic-release`

Adds semantic-release configuration and a workflow appropriate for the target
repository.

```bash
devu add-semantic-release [project-dir] \
  [--mode auto|ci-npx|local-node] \
  [--dry-run]
```

Available modes:

- `auto`: use local dependencies for Node.js projects and CI/npx for other
  projects;
- `ci-npx`: language-independent setup that does not modify `package.json`;
- `local-node`: install semantic-release dependencies in the target Node.js
  project.

The command asks before writing configuration or workflow files. For Node.js
packages, it can also configure npm publishing with `@semantic-release/npm`.

### `devu pg init`

Creates an isolated database and role inside an existing, running PostgreSQL
container. It never creates, starts, stops, or removes Docker containers.

Preview the changes first:

```bash
devu pg init ./story-audio \
  --container shared-postgres \
  --dry-run
```

Then provision the database after reviewing the plan:

```bash
devu pg init ./story-audio --container shared-postgres
```

The command writes `DATABASE_URL` to `.env.local` by default. The container
name is used as the connection host so another container on the same Docker
network can connect. Use `--host` for a different service name or hostname.

Run the command-specific help to see database, user, password, host, and env
file options:

```bash
devu pg init --help
```

### `devu git-branches`

Lists, cleans up, and syncs local git branches that are outdated. A branch is
flagged stale when it is merged into the default branch, or its upstream has
been deleted, and its last commit is older than the threshold. The current
branch and the default branch are always protected.

```bash
devu git-branches list [project-dir] [--older-than-days 90] [--protect name]
devu git-branches sync [project-dir] [--dry-run]
devu git-branches clean [project-dir] [--older-than-days 90] [--protect name] [--dry-run] [--yes] [--force]
```

Preview the changes first:

```bash
devu git-branches clean --dry-run
```

Then delete after reviewing the plan; the command asks for confirmation
unless `--yes` is passed:

```bash
devu git-branches clean
```

Cleanly-merged branches are deleted with `git branch -d`. Branches whose
upstream was deleted but that are not fully merged are only deleted with
`--force` (`git branch -D`). `devu git-branches sync` runs `git fetch --prune`
to update which branches show as having a deleted upstream, without deleting
any local branches itself.

See the [git branch cleanup design](docs/git-branches-plan.md) for the full
staleness rules and safety rationale.

### `devu ports`

Finds and stops the process(es) listening on a TCP port. Never signals pid 1
or the CLI's own process.

```bash
devu ports list --port 3000
devu ports kill --port 3000 [--dry-run] [--yes] [--force]
```

Preview before stopping anything:

```bash
devu ports kill --port 3000 --dry-run
```

Then stop the process after reviewing the plan; the command asks for
confirmation unless `--yes` is passed. `kill` sends `SIGTERM` by default;
pass `--force` to send `SIGKILL` instead:

```bash
devu ports kill --port 3000
```

On macOS and Linux this shells out to `lsof`; on Windows it uses `netstat`
(and cannot resolve a process name, only its pid).

### `devu node-cleanup`

Lists and deletes `node_modules` directories under a root directory that
look abandoned: the `node_modules` directory itself, its sibling
`package.json`, and (for a git project) its last commit are all older than
the threshold.

```bash
devu node-cleanup list --root ~/projects [--older-than-days 30]
devu node-cleanup clean --root ~/projects [--older-than-days 30] [--dry-run] [--yes]
```

Preview before deleting anything:

```bash
devu node-cleanup clean --root ~/projects --dry-run
```

Then delete after reviewing the plan and the total reclaimable size; the
command asks for confirmation unless `--yes` is passed:

```bash
devu node-cleanup clean --root ~/projects
```

`--root` is required (no implicit whole-disk scan), and the command refuses
to scan the filesystem root or your home directory directly.

## Help and command aliases

Use built-in help for the current list of options:

```bash
devu --help
devu add-licenses --help
devu add-semantic-release --help
devu pg init --help
devu git-branches list --help
devu git-branches sync --help
devu git-branches clean --help
devu ports list --help
devu ports kill --help
devu node-cleanup list --help
devu node-cleanup clean --help
```

`develop-utils` remains available as a long-form alias. The package also ships
the standalone `add-licenses` and `add-semantic-release` commands, but `devu`
is the recommended interface.

## More documentation

- [Semantic release setup](docs/semantic-release.md)
- [npm publishing checklist](docs/npm-publishing.md)
- [PostgreSQL provisioning plan](docs/postgres-provisioning-plan.md)
- [Git branch cleanup design](docs/git-branches-plan.md)
- [Feature rationale and language support](FEATURE.md)

## Development

Install this repository locally as a global command while developing it:

```bash
npm install
npm run build
npm install --global .
devu --help
```

Run the automated tests and inspect the npm package contents before publishing:

```bash
npm test
npm run pack:dry-run
```

## Publishing

```bash
npm login
npm publish --access public
```

The npm package is published as `devu-utils` and exposes `devu` as its primary
command.

## License

MIT. See [LICENSE](LICENSE).
