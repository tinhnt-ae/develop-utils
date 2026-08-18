import path from "node:path";
import { isGitRepository } from "../../shared/git.js";
import { runCommand } from "../../shared/process.js";

interface GitBranchesSyncOptions {
  dryRun: boolean;
  help: boolean;
  projectDir: string;
}

export function syncHelp(): string {
  return `Usage: devu git-branches sync [project-dir] [--dry-run]

Fetches from origin and prunes local remote-tracking branches that no
longer exist on the remote. Does not delete any local branches.

Options:
  --dry-run   Print the command that would run without fetching.`;
}

function parseSyncArgs(argv: string[]): GitBranchesSyncOptions {
  const options: GitBranchesSyncOptions = {
    dryRun: false,
    help: false,
    projectDir: process.cwd(),
  };
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
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
  return options;
}

export async function runGitBranchesSync(argv = process.argv.slice(2)): Promise<void> {
  const options = parseSyncArgs(argv);

  if (options.help) {
    console.log(syncHelp());
    return;
  }

  if (!isGitRepository(options.projectDir)) {
    throw new Error(`${options.projectDir} is not a git repository`);
  }

  if (options.dryRun) {
    console.log(`DRY RUN: git fetch --prune origin (in ${options.projectDir})`);
    console.log("Rerun without --dry-run to fetch and prune.");
    return;
  }

  console.log(`Fetching and pruning origin in ${options.projectDir}...`);
  runCommand("git", ["fetch", "--prune", "origin"], { cwd: options.projectDir });
  console.log("Sync complete.");
}
