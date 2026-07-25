
# Develop-utils
A small CLI for generating repeatable repository setup files 
— licenses
- authorship docs
- line-ending policy
- semantic-release workflows — with git-derived defaults and dry-run review before writing.

## Install

```bash
npm install -g devu-utils
```

Or run without installing:

```bash
npx --package devu-utils devu add-licenses
npx --package devu-utils devu add-semantic-release
```

## Commands

```bash
devu add-licenses [project-dir] [--project-name name] [--dry-run]
devu add-semantic-release [project-dir] [--mode auto|ci-npx|local-node] [--dry-run]
devu pg init [project-dir] --container existing-postgres [--dry-run]
```

Long-form and standalone bins are also available:

```bash
develop-utils
add-licenses
add-semantic-release
```

## License Metadata

`add-licenses` reads repository metadata dynamically:

- owner name: `git config user.name`
- owner email: `git config user.email`
- repository URL: `git remote get-url origin`
- GitHub username: parsed from the origin URL when possible
- project start date: first commit date, falling back to today

Environment overrides:

```bash
DEVELOP_UTILS_FULL_NAME="Your Legal Name"
DEVELOP_UTILS_EMAIL="you@example.com"
DEVELOP_UTILS_GITHUB_USERNAME="your-github-user"
```

`add-licenses` asks before creating `COPYRIGHT.md`, `AUTHORSHIP.md`, and
`.gitattributes`. If `LICENSE` already exists, it asks before overwriting it.
Type `y` or `n` and press Enter for each question.

## Semantic Release Modes

`add-semantic-release` supports `auto`, `local-node`, and `ci-npx` modes. It
asks before writing release config or workflow files, and can optionally enable
`@semantic-release/npm` for npm package publishing.

`pg init` creates a project-specific database and role in an existing running
PostgreSQL container. It never creates or starts containers. Preview first, then
approve interactively or pass `--yes` for automation:

```bash
devu pg init ./story-audio --container shared-postgres --dry-run
devu pg init ./story-audio --container shared-postgres
```

The generated `DATABASE_URL` uses the container name as its host so another
container on the same Docker network can connect. Use `--host` when the project
needs a different Docker service name or hostname. Existing `DATABASE_URL`
values require confirmation; automation must use `--yes --force` to replace one.

See:

- [Semantic release setup](docs/semantic-release.md)
- [npm publishing checklist](docs/npm-publishing.md)
- [PostgreSQL provisioning plan](docs/postgres-provisioning-plan.md)

## Why

See `FEATURE.md` for the longer rationale, pain points, and language support matrix.

## License

MIT. See `LICENSE`.

## Publishing

```bash
cd develop-utils
npm login
npm publish --access public
```

The package is prepared for public npm publishing. Actual publishing requires
npm credentials and the package name to be available.
