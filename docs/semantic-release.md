# Semantic Release Setup

`add-semantic-release` adds release configuration and provider-specific CI
workflows with git-derived defaults.

## Modes

`add-semantic-release` defaults to `--mode auto`.

- `auto`: Node projects use local package-manager dependencies; non-Node repos use CI/npx mode.
- `local-node`: installs semantic-release into the target Node project with npm, pnpm, or yarn.
- `ci-npx`: language-agnostic; generates release config and CI workflow without creating `package.json`.

Use `ci-npx` for Kotlin, Java, Python, Rust, Go, docs, or any repo where release
automation should not add Node project files.

Before writing release config or workflow files, `add-semantic-release` asks for
approval. In `local-node` mode it also asks before creating/updating
`package.json` and before installing semantic-release dependencies.

For Node package repositories, `add-semantic-release` also asks:

```text
Publish this package to npm with @semantic-release/npm? [y/n]
```

Answer `y` only when the package should be published to the npm registry. The
command then adds `@semantic-release/npm`, includes it in the local install or
generated npx release command, adds GitHub Actions `id-token: write`, and
configures the workflow for npm Trusted Publishing.

See [npm publishing](./npm-publishing.md) before enabling npm publishing.
