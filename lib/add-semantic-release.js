import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  detectDefaultBranch,
  detectPackageManager,
  detectProvider,
  getGitMetadata,
  isGitRepository,
  parseCommonArgs,
  runCommand,
} from "./common.js";

const baseDeps = [
  "semantic-release",
  "@semantic-release/commit-analyzer",
  "@semantic-release/release-notes-generator",
  "@semantic-release/changelog",
  "@semantic-release/git",
];

export function help() {
  return `Usage: develop-utils add-semantic-release [project-dir] [--mode auto|ci-npx|local-node] [--dry-run]

Adds semantic-release setup to a repository.

Modes:
  auto        Node projects use local dependencies; non-Node repos use CI/npx mode.
  ci-npx      Language-agnostic; no package.json is created or modified.
  local-node  Install semantic-release into the target Node project.`;
}

function nodeMeetsSemanticReleaseRequirement(version) {
  const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 22 || (major === 22 && (minor > 14 || (minor === 14 && patch >= 0)));
}

function installCommand(packageManager, deps) {
  if (packageManager === "pnpm") {
    return ["pnpm", ["add", "-D", ...deps]];
  }
  if (packageManager === "yarn") {
    return ["yarn", ["add", "-D", ...deps]];
  }
  return ["npm", ["install", "--save-dev", ...deps]];
}

function ciInstallCommand(packageManager) {
  if (packageManager === "pnpm") {
    return "pnpm install --frozen-lockfile";
  }
  if (packageManager === "yarn") {
    return "yarn install --immutable";
  }
  return "npm ci";
}

function ciReleaseCommand(packageManager) {
  if (packageManager === "pnpm") {
    return "pnpm exec semantic-release";
  }
  if (packageManager === "yarn") {
    return "yarn semantic-release";
  }
  return "npx semantic-release";
}

function npxReleaseCommand(provider) {
  const packages = [
    "semantic-release@latest",
    "@semantic-release/changelog@latest",
    "@semantic-release/git@latest",
  ];

  if (provider === "github") {
    packages.push("@semantic-release/github@latest");
  } else if (provider === "gitlab") {
    packages.push("@semantic-release/gitlab@latest");
  }

  return `npx ${packages.map((pkg) => `--package ${pkg}`).join(" ")} semantic-release`;
}

function semanticReleaseConfig(branch, provider, mode) {
  const assets = ["CHANGELOG.md"];

  if (mode === "local-node") {
    assets.push("package.json");
  }

  const plugins = [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      { changelogFile: "CHANGELOG.md" },
    ],
    [
      "@semantic-release/git",
      {
        assets,
        message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
  ];

  if (provider === "github") {
    plugins.push("@semantic-release/github");
  } else if (provider === "gitlab") {
    plugins.push("@semantic-release/gitlab");
  }

  return `${JSON.stringify({ branches: [branch], plugins }, null, 2)}\n`;
}

function githubWorkflow(branch, provider, mode, packageManager) {
  const install = mode === "local-node" ? ciInstallCommand(packageManager) : "";
  const release = mode === "local-node" ? ciReleaseCommand(packageManager) : npxReleaseCommand(provider);
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

  return `name: Release

on:
  push:
    branches:
      - ${branch}

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${pnpmSetup}
      - uses: actions/setup-node@v4
        with:
          node-version: 24${cache}
${installStep}
      - run: ${release}
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}

function gitlabWorkflow(branch, provider, mode, packageManager) {
  const installStep = mode === "local-node" ? `    - ${ciInstallCommand(packageManager)}\n` : "";
  const release = mode === "local-node" ? ciReleaseCommand(packageManager) : npxReleaseCommand(provider);

  return `release:
  image: node:24
  script:
${installStep}    - ${release}
  only:
    - ${branch}
`;
}

function bitbucketWorkflow(branch, provider, mode, packageManager) {
  const installStep = mode === "local-node" ? `            - ${ciInstallCommand(packageManager)}\n` : "";
  const release = mode === "local-node" ? ciReleaseCommand(packageManager) : npxReleaseCommand(provider);

  return `pipelines:
  branches:
    ${branch}:
      - step:
          image: node:24
          script:
${installStep}            - ${release}
`;
}

async function writeOrPreview(projectDir, dryRun, fileName, content) {
  const target = path.join(projectDir, fileName);

  if (dryRun) {
    console.log(`DRY RUN write: ${target}`);
    if (fileName === ".releaserc.json") {
      console.log(content.trimEnd());
    }
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function ensurePackageJson(projectDir, packageManager, dryRun) {
  if (existsSync(path.join(projectDir, "package.json"))) {
    return;
  }

  if (dryRun) {
    console.log(`DRY RUN command: ${packageManager} init${packageManager === "npm" || packageManager === "yarn" ? " -y" : ""}`);
    return;
  }

  if (packageManager === "pnpm") {
    runCommand("pnpm", ["init"], { cwd: projectDir, stdio: "inherit" });
  } else if (packageManager === "yarn") {
    runCommand("yarn", ["init", "-y"], { cwd: projectDir, stdio: "inherit" });
  } else {
    runCommand("npm", ["init", "-y"], { cwd: projectDir, stdio: "inherit" });
  }
}

async function updatePackageJson(projectDir, dryRun) {
  const target = path.join(projectDir, "package.json");

  if (dryRun) {
    console.log(`DRY RUN update: ${target} script release=semantic-release`);
    return;
  }

  const pkg = JSON.parse(await readFile(target, "utf8"));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.release = "semantic-release";
  await writeFile(target, `${JSON.stringify(pkg, null, 2)}\n`);
}

export async function runAddSemanticRelease(argv = process.argv.slice(2)) {
  const options = parseCommonArgs(argv);

  if (options.help) {
    console.log(help());
    return;
  }

  if (!isGitRepository(options.projectDir)) {
    throw new Error(`Not a git repository or worktree: ${options.projectDir}`);
  }

  const git = getGitMetadata(options.projectDir);
  const provider = detectProvider(git.remoteUrl);

  if (!provider) {
    throw new Error(`Unsupported or missing git provider from origin remote: ${git.remoteUrl || "<none>"}`);
  }

  const branch = detectDefaultBranch(options.projectDir);
  const packageManager = detectPackageManager(options.projectDir);
  const hasPackageJson = existsSync(path.join(options.projectDir, "package.json"));
  const mode = options.mode === "auto"
    ? hasPackageJson ? "local-node" : "ci-npx"
    : options.mode;
  const nodeVersion = process.versions.node;

  if (!["auto", "ci-npx", "local-node"].includes(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}. Use auto, ci-npx, or local-node.`);
  }

  if (mode === "local-node" && !nodeMeetsSemanticReleaseRequirement(nodeVersion)) {
    const message = `Current semantic-release requires Node.js 22.14.0 or newer. Found: ${nodeVersion}`;
    if (options.dryRun) {
      console.log(`DRY RUN warning: ${message}`);
    } else {
      throw new Error(message);
    }
  }

  const providerDeps = provider === "github"
    ? ["@semantic-release/github"]
    : provider === "gitlab"
      ? ["@semantic-release/gitlab"]
      : [];
  const deps = [...baseDeps, ...providerDeps];
  const [installBin, installArgs] = installCommand(packageManager, deps);

  console.log(`Project directory: ${options.projectDir}`);
  console.log(`Provider: ${provider}`);
  console.log(`Default branch: ${branch}`);
  console.log(`Mode: ${mode}`);
  if (mode === "local-node") {
    console.log(`Package manager: ${packageManager}`);
  }
  console.log(`Node.js: ${nodeVersion}`);

  if (mode === "local-node") {
    await ensurePackageJson(options.projectDir, packageManager, options.dryRun);

    if (options.dryRun) {
      console.log(`DRY RUN command: ${installBin} ${installArgs.join(" ")}`);
    } else {
      runCommand(installBin, installArgs, { cwd: options.projectDir, stdio: "inherit" });
    }
  } else {
    console.log(`Release command: ${npxReleaseCommand(provider)}`);
  }

  await writeOrPreview(options.projectDir, options.dryRun, ".releaserc.json", semanticReleaseConfig(branch, provider, mode));
  if (mode === "local-node") {
    await updatePackageJson(options.projectDir, options.dryRun);
  }

  if (provider === "github") {
    await writeOrPreview(options.projectDir, options.dryRun, ".github/workflows/release.yml", githubWorkflow(branch, provider, mode, packageManager));
  } else if (provider === "gitlab") {
    await writeOrPreview(options.projectDir, options.dryRun, ".gitlab-ci.yml", gitlabWorkflow(branch, provider, mode, packageManager));
  } else {
    await writeOrPreview(options.projectDir, options.dryRun, "bitbucket-pipelines.yml", bitbucketWorkflow(branch, provider, mode, packageManager));
  }

  console.log("");
  console.log(`semantic-release ${options.dryRun ? "setup planned" : "is ready"}.`);
  console.log(`Next: git commit -m "chore: setup semantic-release (${provider})"`);
}
