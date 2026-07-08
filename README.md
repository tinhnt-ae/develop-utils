
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
npx develop-utils add-licenses
npx develop-utils add-semantic-release
```

## Commands

```bash
develop-utils add-licenses [project-dir] [--project-name name] [--dry-run]
develop-utils add-semantic-release [project-dir] [--mode auto|ci-npx|local-node] [--dry-run]
```

Standalone bins are also available:

```bash
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

## Semantic Release Modes

`add-semantic-release` defaults to `--mode auto`.

- `auto`: Node projects use local package-manager dependencies; non-Node repos use CI/npx mode.
- `local-node`: installs semantic-release into the target Node project with npm, pnpm, or yarn.
- `ci-npx`: language-agnostic; generates release config and CI workflow without creating `package.json`.

Use `ci-npx` for Kotlin, Java, Python, Rust, Go, docs, or any repo where release automation should not add Node project files.

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
