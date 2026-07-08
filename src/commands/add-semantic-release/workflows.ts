import type { GitProvider, PackageManager } from "../../shared/types.js";
import { ciInstallCommand, ciReleaseCommand } from "./package-manager.js";
import { npxReleaseCommand } from "./provider.js";
import type { ResolvedSemanticReleaseMode } from "./types.js";

export function githubWorkflow(
  branch: string,
  provider: GitProvider,
  mode: ResolvedSemanticReleaseMode,
  packageManager: PackageManager,
  publishToNpm = false,
): string {
  const install = mode === "local-node" ? ciInstallCommand(packageManager) : "";
  const release = mode === "local-node" ? ciReleaseCommand(packageManager) : npxReleaseCommand(provider, publishToNpm);
  const pnpmSetup = mode === "local-node" && packageManager === "pnpm"
    ? `
      - uses: pnpm/action-setup@v4
        with:
          run_install: false
`
    : "";
  const cache = mode === "local-node"
    ? `
          cache: ${packageManager === "npm" ? "npm" : packageManager}`
    : "";
  const registry = publishToNpm
    ? `
          registry-url: https://registry.npmjs.org`
    : "";
  const installStep = install
    ? `
      - run: ${install}
`
    : "";

  return `name: Release

on:
  push:
    branches:
      - ${branch}

permissions:
  contents: write
  issues: write
  pull-requests: write${publishToNpm ? "\n  id-token: write" : ""}

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${pnpmSetup}
      - uses: actions/setup-node@v4
        with:
          node-version: 24${registry}${cache}
${installStep}
      - run: ${release}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
${publishToNpm ? "          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n" : ""}
`;
}

export function gitlabWorkflow(
  branch: string,
  provider: GitProvider,
  mode: ResolvedSemanticReleaseMode,
  packageManager: PackageManager,
  publishToNpm = false,
): string {
  const installStep = mode === "local-node" ? `    - ${ciInstallCommand(packageManager)}\n` : "";
  const release = mode === "local-node" ? ciReleaseCommand(packageManager) : npxReleaseCommand(provider, publishToNpm);

  return `release:
  image: node:24
  script:
${installStep}    - ${release}
  only:
    - ${branch}
`;
}

export function bitbucketWorkflow(
  branch: string,
  provider: GitProvider,
  mode: ResolvedSemanticReleaseMode,
  packageManager: PackageManager,
  publishToNpm = false,
): string {
  const installStep = mode === "local-node" ? `            - ${ciInstallCommand(packageManager)}\n` : "";
  const release = mode === "local-node" ? ciReleaseCommand(packageManager) : npxReleaseCommand(provider, publishToNpm);

  return `pipelines:
  branches:
    ${branch}:
      - step:
          image: node:24
          script:
${installStep}            - ${release}
`;
}
