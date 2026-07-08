
# Develop-utils
A small CLI for generating repeatable repository setup files 
— licenses
- authorship docs
- line-ending policy
- semantic-release workflows — with git-derived defaults and dry-run review before writing.

## Install

```bash
npm install -g develop-utils
```

Or run without installing:

```bash
npx --package develop-utils devu add-licenses
npx --package develop-utils devu add-semantic-release
```

## Commands

```bash
devu add-licenses [project-dir] [--project-name name] [--dry-run]
devu add-semantic-release [project-dir] [--mode auto|ci-npx|local-node] [--dry-run]
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

`add-semantic-release` defaults to `--mode auto`.

- `auto`: Node projects use local package-manager dependencies; non-Node repos use CI/npx mode.
- `local-node`: installs semantic-release into the target Node project with npm, pnpm, or yarn.
- `ci-npx`: language-agnostic; generates release config and CI workflow without creating `package.json`.

Use `ci-npx` for Kotlin, Java, Python, Rust, Go, docs, or any repo where release automation should not add Node project files.

Before writing release config or workflow files, `add-semantic-release` asks for
approval. In `local-node` mode it also asks before creating/updating
`package.json` and before installing semantic-release dependencies. Type `y` or
`n` and press Enter for each question.

For Node package repositories, `add-semantic-release` also asks:

```text
Publish this package to npm with @semantic-release/npm? [y/n]
```

Answer `y` when the package should be published to the npm registry. The command
then adds `@semantic-release/npm` to the release config, includes it in the
local install or generated npx release command, and adds GitHub Actions
`id-token: write` permission for npm trusted publishing.

Before enabling npm publishing, prepare:

- npm package ownership or publish access for the package name
- npm Trusted Publisher configured for `.github/workflows/release.yml`
- Conventional Commits for release versioning
- local verification with `npm test`, `npm run pack:dry-run`, and `npx semantic-release --dry-run`

## Why

See `FEATURE.md` for the longer rationale, pain points, and language support matrix.

## Publishing

```bash
cd develop-utils
npm login
npm publish --access public
```

The package is prepared for public npm publishing. Actual publishing requires
npm credentials and the package name to be available.
