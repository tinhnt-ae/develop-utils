import type { GitProvider, PackageManager } from "../../shared/types.js";
import { ciInstallCommand, ciReleaseCommand } from "./package-manager.js";
import { npxReleaseCommand } from "./provider.js";
import type { ResolvedSemanticReleaseMode } from "./types.js";

const validationCommands = ["npm ci", "npm run build", "npm test", "npm run pack:dry-run"] as const;

export function assertReleaseWorkflowGate(workflow: string, provider: GitProvider): void {
  for (const command of validationCommands) {
    if (!workflow.includes(command)) {
      throw new Error(`Release workflow validation is missing required command: ${command}`);
    }
  }

  if (/if:\s*always\(\)/.test(workflow)) {
    throw new Error("Release workflow must not bypass failed validation with if: always().");
  }

  const semanticReleasePositions = [...workflow.matchAll(/semantic-release/g)].map((match) => match.index || 0);
  const validationStart = provider === "github"
    ? workflow.indexOf("  validation:")
    : provider === "gitlab"
      ? workflow.indexOf("validation:")
      : workflow.indexOf("name: Validate");
  const releaseStart = provider === "github"
    ? workflow.indexOf("  release:")
    : provider === "gitlab"
      ? workflow.indexOf("release:")
      : workflow.indexOf("name: Release");

  if (validationStart < 0 || releaseStart <= validationStart) {
    throw new Error("Release workflow must place release after a validation job or step.");
  }
  if (semanticReleasePositions.length === 0 || semanticReleasePositions.some((position) => position < releaseStart)) {
    throw new Error("semantic-release must appear only in the release job or step.");
  }

  if (provider === "github" && !/release:\s*\n\s+needs:\s*validation\b/.test(workflow)) {
    throw new Error("GitHub release job must depend on validation.");
  }
  if (provider === "gitlab" && !/stages:\s*\n\s+- validate\s*\n\s+- release/.test(workflow)) {
    throw new Error("GitLab release stage must follow validation.");
  }
}

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
  const installStep = install
    ? `
      - run: ${install}
`
    : "";

  const workflow = `name: Release

on:
  push:
    branches:
      - ${branch}

jobs:
  validation:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24

      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run pack:dry-run

  release:
    needs: validation
    permissions:
      contents: write
      issues: write
      pull-requests: write${publishToNpm ? "\n      id-token: write" : ""}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
${pnpmSetup}
      - uses: actions/setup-node@v5
        with:
          node-version: 24${cache}
${installStep}
      - run: ${release}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
  assertReleaseWorkflowGate(workflow, "github");
  return workflow;
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

  const workflow = `stages:
  - validate
  - release

validation:
  stage: validate
  image: node:24
  script:
    - npm ci
    - npm run build
    - npm test
    - npm run pack:dry-run
  only:
    - ${branch}

release:
  stage: release
  image: node:24
  script:
${installStep}    - ${release}
  only:
    - ${branch}
`;
  assertReleaseWorkflowGate(workflow, "gitlab");
  return workflow;
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

  const workflow = `pipelines:
  branches:
    ${branch}:
      - step:
          name: Validate
          image: node:24
          script:
            - npm ci
            - npm run build
            - npm test
            - npm run pack:dry-run
      - step:
          name: Release
          image: node:24
          script:
${installStep}            - ${release}
`;
  assertReleaseWorkflowGate(workflow, "bitbucket");
  return workflow;
}
