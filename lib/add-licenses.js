import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  formatDate,
  getFirstCommitDate,
  getGitMetadata,
  isGitRepository,
  parseCommonArgs,
  today,
} from "./common.js";

export function help() {
  return `Usage: develop-utils add-licenses [project-dir] [--project-name name] [--dry-run]

Creates LICENSE, COPYRIGHT.md, AUTHORSHIP.md, and .gitattributes.

Metadata defaults come from git config:
  git config user.name
  git config user.email
  git remote get-url origin

Environment overrides:
  DEVELOP_UTILS_FULL_NAME
  DEVELOP_UTILS_EMAIL
  DEVELOP_UTILS_GITHUB_USERNAME`;
}

function licenseText(values) {
  return `Copyright (c) ${values.yearRange} ${values.fullName}. All rights reserved.

PROPRIETARY AND CONFIDENTIAL

This software and associated documentation files (the "Software") are the
exclusive property of ${values.fullName} ("Owner").

All rights, title, and interest in and to the Software, including all
intellectual property rights, are and shall remain the exclusive property
of the Owner.

RESTRICTIONS:

1. No person or entity may use, copy, modify, merge, publish, distribute,
   sublicense, or sell copies of the Software without prior written
   permission from the Owner.

2. Unauthorized copying, modification, distribution, or use of this Software,
   via any medium, is strictly prohibited and constitutes a violation of
   copyright law.

3. This Software is provided for the Owner's exclusive use and development.
   Any use by third parties requires explicit written authorization.

4. Reverse engineering, decompilation, or disassembly of this Software is
   strictly prohibited.

OWNERSHIP:

This Software was authored entirely by ${values.fullName}. All source code,
documentation, design, architecture, and related materials are original works
created by the Owner.

Git commit history and repository records serve as evidence of authorship and
creation dates.

NO WARRANTY:

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED. IN NO EVENT SHALL THE OWNER BE LIABLE FOR ANY CLAIM, DAMAGES, OR
OTHER LIABILITY ARISING FROM THE USE OF THIS SOFTWARE.

For licensing inquiries: ${values.email}

Last updated: ${values.todayDate}
`;
}

function copyrightText(values) {
  return `# Copyright Notice

## Ownership

**${values.projectName}** and all associated source code, documentation, and related
materials are the exclusive intellectual property of **${values.fullName}**.

## Authorship

This software was created entirely by ${values.fullName} as an independent work.
All code commits, architectural decisions, and implementation details were
authored solely by ${values.fullName}.

## Evidence of Ownership

The Git commit history of this repository serves as contemporaneous evidence of:
- Authorship by ${values.fullName}
- Creation dates and timeline
- Sole contribution to the codebase

**Project Timeline:**
- Original development began: ${values.startDate}
- First commit: ${values.firstCommitDate}
- Repository: ${values.repoUrl}

## Rights

All rights are reserved. No license is granted for any use, modification,
distribution, or commercialization of this software without explicit written
permission from ${values.fullName}.

## Contact

For licensing inquiries or permissions: ${values.email}

---

**${values.fullName}**
**${values.todayDate}**
`;
}

function authorshipText(values) {
  return `# Authorship Declaration

## Sole Author

I, **${values.fullName}**, hereby declare that I am the sole author of
**${values.projectName}** and all associated code, documentation, and materials
in this repository.

## Creation Timeline

- **Project conception**: ${values.startDate}
- **Initial development**: ${values.startDate}
- **First commit**: ${values.firstCommitDate}
- **Repository**: ${values.repoUrl}

## Authorship Evidence

All commits in this repository's Git history are authored by:
- Name: ${values.gitName}
- Email: ${values.gitEmail}
- GitHub: ${values.githubUsername}

## Development Process

This software was developed independently by me using:
- Personal computer and development environment
- Personal time (evenings and weekends)
- Personal resources
- No employer resources or work time

## Intellectual Property

I confirm that:
1. I created all source code in this repository
2. I designed all architecture and technical decisions
3. I own all intellectual property rights
4. No portion of this code was created by others
5. No portion of this code is subject to any third-party claims
6. I have never assigned, transferred, or licensed these rights to any other party

## Declaration Date

This declaration is made on ${values.todayDate}.

**Signed (digitally via Git commit):**

${values.fullName}
${values.todayDate}
`;
}

function gitattributesText() {
  return `# Protect license files from modification
LICENSE merge=ours
COPYRIGHT.md merge=ours
AUTHORSHIP.md merge=ours

# Ensure consistent line endings
* text=auto
*.js text eol=lf
*.md text eol=lf
*.json text eol=lf
*.yml text eol=lf
`;
}

async function writeOrPreview(projectDir, dryRun, fileName, content) {
  const target = path.join(projectDir, fileName);

  if (dryRun) {
    console.log(`DRY RUN write: ${target}`);
    return;
  }

  await writeFile(target, content);
}

export async function runAddLicenses(argv = process.argv.slice(2)) {
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

  const values = {
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

  await writeOrPreview(options.projectDir, options.dryRun, "LICENSE", licenseText(values));
  await writeOrPreview(options.projectDir, options.dryRun, "COPYRIGHT.md", copyrightText(values));
  await writeOrPreview(options.projectDir, options.dryRun, "AUTHORSHIP.md", authorshipText(values));
  await writeOrPreview(options.projectDir, options.dryRun, ".gitattributes", gitattributesText());

  console.log("");
  console.log(`License files ${options.dryRun ? "planned" : "created"} for: ${values.projectName}`);
  console.log("");
  console.log("Files:");
  console.log("  - LICENSE");
  console.log("  - COPYRIGHT.md");
  console.log("  - AUTHORSHIP.md");
  console.log("  - .gitattributes");
}
