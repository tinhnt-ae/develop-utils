import { existsSync } from "node:fs";
import path from "node:path";
import { formatDate, today } from "../../shared/dates.js";
import { writeTextFile } from "../../shared/filesystem.js";
import { getFirstCommitDate, getGitMetadata, isGitRepository } from "../../shared/git.js";
import { parseCommonArgs } from "../../shared/args.js";
import { confirmAction } from "../../shared/prompts.js";
import type { LicenseTemplateValues } from "./types.js";
import { authorshipText, copyrightText, gitattributesText, licenseText } from "./templates.js";

const licenseFiles = ["LICENSE", "COPYRIGHT.md", "AUTHORSHIP.md", ".gitattributes"] as const;

export function help(): string {
  return `Usage: devu add-licenses [project-dir] [--project-name name] [--dry-run]

Creates LICENSE, COPYRIGHT.md, AUTHORSHIP.md, and .gitattributes.

LICENSE is created directly when missing, but overwriting an existing LICENSE
requires approval. COPYRIGHT.md, AUTHORSHIP.md, and .gitattributes require
approval before create or overwrite.

Metadata defaults come from git config:
  git config user.name
  git config user.email
  git remote get-url origin

Environment overrides:
  DEVELOP_UTILS_FULL_NAME
  DEVELOP_UTILS_EMAIL
  DEVELOP_UTILS_GITHUB_USERNAME`;
}

async function writeOrPreview(projectDir: string, dryRun: boolean, fileName: string, content: string): Promise<"planned" | "written"> {
  const target = path.join(projectDir, fileName);

  if (dryRun) {
    console.log(`DRY RUN write: ${target}`);
    return "planned";
  }

  await writeTextFile(target, content);
  return "written";
}

async function shouldWriteLicenseFile(
  projectDir: string,
  fileName: typeof licenseFiles[number],
  dryRun: boolean,
): Promise<boolean> {
  if (dryRun) {
    return true;
  }

  const target = path.join(projectDir, fileName);
  const exists = existsSync(target);

  if (fileName === "LICENSE" && !exists) {
    return true;
  }

  const action = exists ? "Overwrite existing" : "Create";
  return confirmAction(`${action} ${target}?`);
}

export async function runAddLicenses(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCommonArgs(argv);

  if (options.help) {
    console.log(help());
    return;
  }

  if (!isGitRepository(options.projectDir)) {
    throw new Error(`Not a git repository or worktree: ${options.projectDir}`);
  }

  const git = getGitMetadata(options.projectDir);
  const now = today();
  const firstCommit = getFirstCommitDate(options.projectDir) || now;
  const currentYear = String(now.getFullYear());
  const startYear = String(firstCommit.getFullYear());
  const fullName = process.env.DEVELOP_UTILS_FULL_NAME || git.name;
  const email = process.env.DEVELOP_UTILS_EMAIL || git.email;
  const githubUsername = process.env.DEVELOP_UTILS_GITHUB_USERNAME || git.githubUsername || "[To be determined]";

  if (!fullName) {
    throw new Error("Could not determine owner name. Set git config user.name or DEVELOP_UTILS_FULL_NAME.");
  }
  if (!email) {
    throw new Error("Could not determine owner email. Set git config user.email or DEVELOP_UTILS_EMAIL.");
  }

  const values: LicenseTemplateValues = {
    projectName: options.projectName,
    fullName,
    email,
    gitName: git.name || fullName,
    gitEmail: git.email || email,
    githubUsername,
    repoUrl: git.remoteUrl || "[To be determined]",
    todayDate: formatDate(now),
    startDate: formatDate(firstCommit),
    firstCommitDate: formatDate(firstCommit),
    yearRange: startYear === currentYear ? currentYear : `${startYear}-${currentYear}`,
  };

  console.log(`Project directory: ${options.projectDir}`);
  console.log(`Project name: ${values.projectName}`);
  console.log(`Owner: ${values.fullName} <${values.email}>`);
  console.log(`Repository: ${values.repoUrl}`);

  const files = [
    [licenseFiles[0], licenseText(values)],
    [licenseFiles[1], copyrightText(values)],
    [licenseFiles[2], authorshipText(values)],
    [licenseFiles[3], gitattributesText()],
  ] as const;
  const approvedFiles: Array<typeof files[number]> = [];
  const changedFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const [fileName, content] of files) {
    if (await shouldWriteLicenseFile(options.projectDir, fileName, options.dryRun)) {
      approvedFiles.push([fileName, content]);
    } else {
      skippedFiles.push(fileName);
    }
  }

  for (const [fileName, content] of approvedFiles) {
    await writeOrPreview(options.projectDir, options.dryRun, fileName, content);
    changedFiles.push(fileName);
  }

  for (const fileName of skippedFiles) {
    console.log(`Skipped: ${fileName}`);
  }

  console.log("");
  console.log(`License files ${options.dryRun ? "planned" : "processed"} for: ${values.projectName}`);
  console.log("");
  console.log(options.dryRun ? "Planned files:" : "Changed files:");
  for (const fileName of changedFiles) {
    console.log(`  - ${fileName}`);
  }
  if (skippedFiles.length > 0) {
    console.log("Skipped files:");
    for (const fileName of skippedFiles) {
      console.log(`  - ${fileName}`);
    }
  }
}
