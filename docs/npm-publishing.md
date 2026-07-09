# npm Publishing Checklist

Use this checklist before enabling `@semantic-release/npm` or deploying a
package to npm.

## Preflight

- Check the package name with `npm view <package-name>`.
- Use a scoped name such as `@your-org/package-name` when publishing under an
  npm organization.
- Confirm npm package ownership or publish access for the exact package name.
- Confirm `package.json` repository metadata matches the GitHub repository.
- Use Conventional Commits so semantic-release can calculate releases.
- Verify locally with `npm test`, `npm run pack:dry-run`, and
  `npx semantic-release --dry-run`.

## Trusted Publishing

For npm Trusted Publishing, configure the trusted publisher on the exact npm
package that semantic-release will publish.

Use these values on npmjs.com:

```text
Provider: GitHub Actions
Repository owner: <github-owner>
Repository name: <github-repo>
Workflow filename: release.yml
Environment name: empty unless the GitHub Actions job declares the same environment
Allowed action: npm publish
```

In GitHub Actions, keep:

```yaml
permissions:
  id-token: write
```

The npm Trusted Publisher workflow filename is only `release.yml`, not
`.github/workflows/release.yml`.

If npm reports:

```text
OIDC token exchange error - package not found
```

then either the package is not published yet, or the Trusted Publisher entry does
not match the GitHub owner, repository, workflow filename, or environment.

For a first publish, publish once locally:

```bash
npm publish --access public --otp <code>
```

Then configure Trusted Publishing on that npm package and rerun CI.

## Avoid

- Do not use a package name that is already owned by another npm user.
- Do not assume npm organization access grants package publish access by itself.
- Do not add `NPM_TOKEN` when using Trusted Publishing unless you intentionally
  want token fallback.
- Do not add `registry-url` to `actions/setup-node` for Trusted Publishing-only
  workflows; it can create confusing token-auth fallback errors.
