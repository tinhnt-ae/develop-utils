import { cleanHelp, runGitBranchesClean } from "./clean.js";
import { listHelp, runGitBranchesList } from "./list.js";
import { syncHelp, runGitBranchesSync } from "./sync.js";

export function gitBranchesHelp(): string {
  return `Usage: devu git-branches <command> [options]

Commands:
  list   List local branches with merge/staleness status.
  sync   Fetch from origin and prune deleted remote-tracking branches.
  clean  Delete local branches that are stale and safe to remove.

Run "devu git-branches <command> --help" for command-specific options.`;
}

export async function runGitBranches(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(gitBranchesHelp());
    return;
  }

  if (command === "list") {
    await runGitBranchesList(args);
    return;
  }

  if (command === "sync") {
    await runGitBranchesSync(args);
    return;
  }

  if (command === "clean") {
    await runGitBranchesClean(args);
    return;
  }

  if (command === "help:list") {
    console.log(listHelp());
    return;
  }

  if (command === "help:sync") {
    console.log(syncHelp());
    return;
  }

  if (command === "help:clean") {
    console.log(cleanHelp());
    return;
  }

  throw new Error(`Unknown git-branches command: ${command}`);
}
