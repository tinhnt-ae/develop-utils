import path from "node:path";
import { formatDate } from "../../shared/dates.js";
import { detectDefaultBranch, isGitRepository, runGit } from "../../shared/git.js";
import { type PlannedAction, printPlannedActions } from "../../shared/plan.js";
import { confirmAction } from "../../shared/prompts.js";
import { isStaleBranch, listLocalBranches } from "./staleness.js";

interface GitBranchesCleanOptions {
  dryRun: boolean;
  force: boolean;
  help: boolean;
  olderThanDays: number;
  projectDir: string;
  protect: string[];
  yes: boolean;
}

const GROUP_ORDER = ["Merged", "Upstream gone (requires --force)"];

export function cleanHelp(): string {
  return `Usage: devu git-branches clean [project-dir] [--older-than-days N] [--protect name] [--dry-run] [--yes] [--force]

Deletes local branches that are merged into the default branch, or whose
upstream has been deleted, and whose last commit is older than the
threshold. The current branch and the default branch are always protected.

Options:
  --older-than-days N  Staleness threshold in days. Defaults to 90.
  --protect name       Branch name to never delete. Repeatable.
  --dry-run            Print the branches that would be deleted without deleting them.
  --yes                Delete without prompting for confirmation.
  --force              Also delete branches that are not fully merged but whose upstream is gone (git branch -D).`;
}

function parseCleanArgs(argv: string[]): GitBranchesCleanOptions {
  const options: GitBranchesCleanOptions = {
    dryRun: false,
    force: false,
    help: false,
    olderThanDays: 90,
    projectDir: process.cwd(),
    protect: [],
    yes: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "-h" || arg === "--help") {
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

export async function runGitBranchesClean(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCleanArgs(argv);

  if (options.help) {
    console.log(cleanHelp());
    return;
  }

  if (!isGitRepository(options.projectDir)) {
    throw new Error(`${options.projectDir} is not a git repository`);
  }

  const defaultBranch = detectDefaultBranch(options.projectDir);
  const branches = listLocalBranches(options.projectDir, defaultBranch);
  const stale = branches.filter((branch) => isStaleBranch(branch, defaultBranch, options.olderThanDays, options.protect));

  console.log(`Project directory: ${options.projectDir}`);
  console.log(`Default branch: ${defaultBranch}`);

  if (stale.length === 0) {
    console.log("No stale local branches found.");
    return;
  }

  const actions: PlannedAction[] = stale.map((branch) => ({
    group: branch.merged ? "Merged" : "Upstream gone (requires --force)",
    description: `Delete "${branch.name}" (last commit ${formatDate(branch.lastCommitDate)})`,
  }));

  if (options.dryRun) {
    printPlannedActions("DRY RUN git branch cleanup plan:", actions, GROUP_ORDER, [
      "No branches were deleted.",
      "Rerun without --dry-run to approve and apply this plan.",
    ]);
    return;
  }

  if (!options.yes) {
    printPlannedActions("Local branches selected for cleanup:", actions, GROUP_ORDER);
    const proceed = await confirmAction(`Delete ${stale.length} stale local branch(es) listed above?`);
    if (!proceed) {
      console.log("Branch cleanup cancelled; nothing was changed.");
      return;
    }
  }

  const deleted: string[] = [];
  const skipped: string[] = [];

  for (const branch of stale) {
    if (!branch.merged && !options.force) {
      skipped.push(branch.name);
      continue;
    }

    runGit(options.projectDir, ["branch", branch.merged ? "-d" : "-D", branch.name]);
    deleted.push(branch.name);
  }

  console.log(`Deleted: ${deleted.length > 0 ? deleted.join(", ") : "none"}`);
  if (skipped.length > 0) {
    console.log(`Skipped (not fully merged; rerun with --force to delete): ${skipped.join(", ")}`);
  }

  const remainingNames = new Set(listLocalBranches(options.projectDir, defaultBranch).map((branch) => branch.name));
  const stillPresent = deleted.filter((name) => remainingNames.has(name));
  if (stillPresent.length > 0) {
    throw new Error(`Failed to delete branch(es): ${stillPresent.join(", ")}`);
  }
}
