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
