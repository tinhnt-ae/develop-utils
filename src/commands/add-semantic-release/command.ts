import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCommonArgs } from "../../shared/args.js";
import { writeTextFile } from "../../shared/filesystem.js";
import { detectDefaultBranch, detectProvider, getGitMetadata, isGitRepository } from "../../shared/git.js";
import { confirmAction } from "../../shared/prompts.js";
import { runCommand } from "../../shared/process.js";
import type { GitProvider } from "../../shared/types.js";
import { detectPackageManager, installCommand } from "./package-manager.js";
import { npxReleaseCommand } from "./provider.js";
import { semanticReleaseConfig } from "./release-config.js";
import type { ResolvedSemanticReleaseMode, SemanticReleaseMode } from "./types.js";
import { bitbucketWorkflow, githubWorkflow, gitlabWorkflow } from "./workflows.js";

const baseDeps = [
  "semantic-release",
  "@semantic-release/commit-analyzer",
  "@semantic-release/release-notes-generator",
  "@semantic-release/changelog",
  "@semantic-release/git",
];

export function help(): string {
  return `Usage: devu add-semantic-release [project-dir] [--mode auto|ci-npx|local-node] [--dry-run]

Adds semantic-release setup to a repository.

Creating or overwriting release config/workflow files requires approval. In
local-node mode, package.json creation/update and dependency installation also
require approval.

For Node package repositories, the command asks whether to add
@semantic-release/npm for npm publishing.

Modes:
  auto        Node projects use local dependencies; non-Node repos use CI/npx mode.
  ci-npx      Language-agnostic; no package.json is created or modified.
  local-node  Install semantic-release into the target Node project.`;
}

function isSemanticReleaseMode(mode: string): mode is SemanticReleaseMode {
  return mode === "auto" || mode === "ci-npx" || mode === "local-node";
}

function nodeMeetsSemanticReleaseRequirement(version: string): boolean {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major > 22 || (major === 22 && (minor > 14 || (minor === 14 && patch >= 0)));
}

function resolveMode(mode: SemanticReleaseMode, hasPackageJson: boolean): ResolvedSemanticReleaseMode {
  if (mode === "auto") {
    return hasPackageJson ? "local-node" : "ci-npx";
  }

  return mode;
}

function shouldAskAboutNpmPublishing(mode: ResolvedSemanticReleaseMode, hasPackageJson: boolean): boolean {
  return hasPackageJson || mode === "local-node";
}

async function writeOrPreview(
  projectDir: string,
  dryRun: boolean,
  fileName: string,
  content: string,
): Promise<void> {
  const target = path.join(projectDir, fileName);

  if (dryRun) {
    console.log(`DRY RUN write: ${target}`);
    if (fileName === ".releaserc.json") {
      console.log(content.trimEnd());
    }
    return;
  }

  await writeTextFile(target, content);
}

async function confirmFileWrite(projectDir: string, fileName: string, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    return true;
  }

  const target = path.join(projectDir, fileName);
  const action = existsSync(target) ? "Overwrite existing" : "Create";
  return confirmAction(`${action} ${target}?`);
}

async function preparePackageJson(projectDir: string, packageManager: string, dryRun: boolean): Promise<boolean> {
  if (existsSync(path.join(projectDir, "package.json"))) {
    return false;
  }

  if (dryRun) {
    console.log(`DRY RUN command: ${packageManager} init${packageManager === "npm" || packageManager === "yarn" ? " -y" : ""}`);
    return false;
  }

  if (!await confirmAction(`Create ${path.join(projectDir, "package.json")} with ${packageManager} init?`)) {
    throw new Error("semantic-release setup cancelled because package.json creation was not approved.");
  }

  return true;
}

function initPackageJson(projectDir: string, packageManager: string): void {
  if (packageManager === "pnpm") {
    runCommand("pnpm", ["init"], { cwd: projectDir, stdio: "inherit" });
  } else if (packageManager === "yarn") {
    runCommand("yarn", ["init", "-y"], { cwd: projectDir, stdio: "inherit" });
  } else {
    runCommand("npm", ["init", "-y"], { cwd: projectDir, stdio: "inherit" });
  }
}

async function updatePackageJson(projectDir: string, dryRun: boolean): Promise<boolean> {
  const target = path.join(projectDir, "package.json");

  if (dryRun) {
    console.log(`DRY RUN update: ${target} script release=semantic-release`);
    return true;
  }

  const pkg = JSON.parse(await readFile(target, "utf8")) as { scripts?: Record<string, string> };
  pkg.scripts = pkg.scripts || {};
  pkg.scripts.release = "semantic-release";
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(pkg, null, 2)}\n`);
  return true;
}

function providerDeps(provider: GitProvider): string[] {
  if (provider === "github") {
    return ["@semantic-release/github"];
  }
  if (provider === "gitlab") {
    return ["@semantic-release/gitlab"];
  }
  return [];
}

export async function runAddSemanticRelease(argv = process.argv.slice(2)): Promise<void> {
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

  if (!isSemanticReleaseMode(options.mode)) {
    throw new Error(`Unsupported mode: ${options.mode}. Use auto, ci-npx, or local-node.`);
  }

  const branch = detectDefaultBranch(options.projectDir);
  const packageManager = detectPackageManager(options.projectDir);
  const hasPackageJson = existsSync(path.join(options.projectDir, "package.json"));
  const mode = resolveMode(options.mode, hasPackageJson);
  const nodeVersion = process.versions.node;

  if (mode === "local-node" && !nodeMeetsSemanticReleaseRequirement(nodeVersion)) {
    const message = `Current semantic-release requires Node.js 22.14.0 or newer. Found: ${nodeVersion}`;
    if (options.dryRun) {
      console.log(`DRY RUN warning: ${message}`);
    } else {
      throw new Error(message);
    }
  }

  const publishToNpm = shouldAskAboutNpmPublishing(mode, hasPackageJson)
    ? await confirmAction("Publish this package to npm with @semantic-release/npm?")
    : false;
  const deps = [...baseDeps, ...(publishToNpm ? ["@semantic-release/npm"] : []), ...providerDeps(provider)];
  const [installBin, installArgs] = installCommand(packageManager, deps);
  const workflowFileName = provider === "github"
    ? ".github/workflows/release.yml"
    : provider === "gitlab"
      ? ".gitlab-ci.yml"
      : "bitbucket-pipelines.yml";
  const workflowContent = provider === "github"
    ? githubWorkflow(branch, provider, mode, packageManager, publishToNpm)
    : provider === "gitlab"
      ? gitlabWorkflow(branch, provider, mode, packageManager, publishToNpm)
      : bitbucketWorkflow(branch, provider, mode, packageManager, publishToNpm);
  const plannedFiles = [
    [".releaserc.json", semanticReleaseConfig(branch, provider, mode, publishToNpm)],
    [workflowFileName, workflowContent],
  ] as const;
  const approvedFiles: Array<typeof plannedFiles[number]> = [];
  const skippedFiles: string[] = [];
  let shouldUpdatePackageJson = false;
  let shouldInitPackageJson = false;

  console.log(`Project directory: ${options.projectDir}`);
  console.log(`Provider: ${provider}`);
  console.log(`Default branch: ${branch}`);
  console.log(`Mode: ${mode}`);
  if (mode === "local-node") {
    console.log(`Package manager: ${packageManager}`);
  }
  if (publishToNpm) {
    console.log("npm publishing: enabled with @semantic-release/npm");
  }
  console.log(`Node.js: ${nodeVersion}`);

  if (mode === "local-node") {
    shouldInitPackageJson = await preparePackageJson(options.projectDir, packageManager, options.dryRun);

    if (options.dryRun) {
      console.log(`DRY RUN command: ${installBin} ${installArgs.join(" ")}`);
    } else {
      if (!await confirmAction(`Install semantic-release dev dependencies with "${installBin} ${installArgs.join(" ")}"?`)) {
        throw new Error("semantic-release setup cancelled because dependency installation was not approved.");
      }
    }
  } else {
    console.log(`Release command: ${npxReleaseCommand(provider, publishToNpm)}`);
  }

  const changedFiles: string[] = [];
  if (mode === "local-node") {
    if (options.dryRun) {
      shouldUpdatePackageJson = true;
    } else if (await confirmAction(`Update ${path.join(options.projectDir, "package.json")} with release script?`)) {
      shouldUpdatePackageJson = true;
    } else {
      skippedFiles.push("package.json");
    }
  }

  for (const [fileName, content] of plannedFiles) {
    if (await confirmFileWrite(options.projectDir, fileName, options.dryRun)) {
      approvedFiles.push([fileName, content]);
    } else {
      skippedFiles.push(fileName);
    }
  }

  if (mode === "local-node" && !options.dryRun) {
    if (shouldInitPackageJson) {
      initPackageJson(options.projectDir, packageManager);
    }
    runCommand(installBin, installArgs, { cwd: options.projectDir, stdio: "inherit" });
  }

  for (const [fileName, content] of approvedFiles) {
    await writeOrPreview(options.projectDir, options.dryRun, fileName, content);
    changedFiles.push(fileName);
  }

  if (mode === "local-node" && shouldUpdatePackageJson) {
    if (await updatePackageJson(options.projectDir, options.dryRun)) {
      changedFiles.push("package.json");
    }
  }

  for (const fileName of skippedFiles) {
    console.log(`Skipped: ${fileName}`);
  }

  if (options.dryRun && mode === "local-node" && shouldUpdatePackageJson && !changedFiles.includes("package.json")) {
    changedFiles.push("package.json");
  }

  console.log(`semantic-release ${options.dryRun ? "setup planned" : "is ready"}.`);
  if (changedFiles.length > 0) {
    console.log(options.dryRun ? "Planned files:" : "Changed files:");
    for (const fileName of changedFiles) {
      console.log(`  - ${fileName}`);
    }
  }
  if (skippedFiles.length > 0) {
    console.log("Skipped files:");
    for (const fileName of skippedFiles) {
      console.log(`  - ${fileName}`);
    }
  }
  if (publishToNpm) {
    console.log("npm auth: configure GitHub secret NPM_TOKEN with an npm automation token, or a granular token with package publish access and 2FA bypass enabled.");
    console.log("Trusted Publishing can be used instead when it is configured for this workflow on npmjs.com.");
  }
  console.log(`Next: git commit -m "chore: setup semantic-release (${provider})"`);
}
