import path from "node:path";
import { formatDate } from "../../shared/dates.js";
import { detectDefaultBranch, isGitRepository } from "../../shared/git.js";
import { isStaleBranch, listLocalBranches } from "./staleness.js";

interface GitBranchesListOptions {
  help: boolean;
  olderThanDays: number;
  projectDir: string;
  protect: string[];
}

export function listHelp(): string {
  return `Usage: devu git-branches list [project-dir] [--older-than-days N] [--protect name]

Lists local branches with their merge, upstream, and staleness status.
A branch is flagged STALE when it is merged into the default branch, or its
upstream has been deleted, and its last commit is older than the threshold.

Options:
  --older-than-days N  Staleness threshold in days. Defaults to 90.
  --protect name       Branch name to never flag as stale. Repeatable.`;
}

function parseListArgs(argv: string[]): GitBranchesListOptions {
  const options: GitBranchesListOptions = {
    help: false,
    olderThanDays: 90,
    projectDir: process.cwd(),
    protect: [],
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--older-than-days") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--older-than-days requires a value");
      }
      options.olderThanDays = Number(argv[i]);
    } else if (arg.startsWith("--older-than-days=")) {
      options.olderThanDays = Number(arg.slice("--older-than-days=".length));
    } else if (arg === "--protect") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--protect requires a value");
      }
      options.protect.push(argv[i]);
    } else if (arg.startsWith("--protect=")) {
      options.protect.push(arg.slice("--protect=".length));
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error("Only one project-dir argument is supported");
  }

  if (positional[0]) {
    options.projectDir = positional[0];
  }

  options.projectDir = path.resolve(options.projectDir);

  if (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 0) {
    throw new Error("--older-than-days must be a non-negative number");
  }

  return options;
}

export async function runGitBranchesList(argv = process.argv.slice(2)): Promise<void> {
  const options = parseListArgs(argv);

  if (options.help) {
    console.log(listHelp());
    return;
  }

  if (!isGitRepository(options.projectDir)) {
    throw new Error(`${options.projectDir} is not a git repository`);
  }

  const defaultBranch = detectDefaultBranch(options.projectDir);
  const branches = listLocalBranches(options.projectDir, defaultBranch);

  console.log(`Project directory: ${options.projectDir}`);
  console.log(`Default branch: ${defaultBranch}`);
  console.log("");

  if (branches.length === 0) {
    console.log("No local branches found.");
    return;
  }

  for (const branch of branches) {
    const stale = isStaleBranch(branch, defaultBranch, options.olderThanDays, options.protect);
    const flags = [
      branch.isCurrent ? "current" : undefined,
      branch.name === defaultBranch ? "default" : undefined,
      branch.merged ? "merged" : undefined,
      branch.upstreamGone ? "upstream gone" : undefined,
      stale ? "STALE" : undefined,
    ].filter(Boolean).join(", ");

    console.log(`${branch.name}\tlast commit ${formatDate(branch.lastCommitDate)}${flags ? ` (${flags})` : ""}`);
  }
}
