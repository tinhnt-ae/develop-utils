import { rm } from "node:fs/promises";
import { formatDate, isOlderThanDays } from "../../shared/dates.js";
import { type PlannedAction, printPlannedActions } from "../../shared/plan.js";
import { confirmAction } from "../../shared/prompts.js";
import { findBuildOutputCandidates, hasUncommittedChanges } from "./build-finder.js";
import { requireRoot } from "./build-list.js";

interface BuildCleanOptions {
  dryRun: boolean;
  help: boolean;
  olderThanDays: number;
  root?: string;
  yes: boolean;
}

const GROUP_ORDER = ["Build output"];

export function buildCleanHelp(): string {
  return `Usage: devu java-cleanup builds clean --root dir [--older-than-days N] [--dry-run] [--yes]

Deletes Maven/Gradle build output directories (target/, build/) under --root
whose build output, and (for a git project) last commit, are older than
--older-than-days. Skips (with a warning) any project with uncommitted git
changes rather than deleting its build output.

Options:
  --root dir             Directory to scan. Required.
  --older-than-days N    Staleness threshold in days. Defaults to 14.
  --dry-run              Print the directories that would be deleted without deleting them.
  --yes                  Delete without prompting for confirmation.`;
}

function parseBuildCleanArgs(argv: string[]): BuildCleanOptions {
  const options: BuildCleanOptions = {
    dryRun: false,
    help: false,
    olderThanDays: 14,
    yes: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--root") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--root requires a value");
      }
      options.root = argv[i];
    } else if (arg.startsWith("--root=")) {
      options.root = arg.slice("--root=".length);
    } else if (arg === "--older-than-days") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--older-than-days requires a value");
      }
      options.olderThanDays = Number(argv[i]);
    } else if (arg.startsWith("--older-than-days=")) {
      options.olderThanDays = Number(arg.slice("--older-than-days=".length));
    } else {
      throw new Error(`Unsupported option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 0) {
    throw new Error("--older-than-days must be a non-negative number");
  }

  return options;
}

export async function runBuildClean(argv = process.argv.slice(2)): Promise<void> {
  const options = parseBuildCleanArgs(argv);

  if (options.help) {
    console.log(buildCleanHelp());
    return;
  }

  const root = requireRoot(options.root);
  const candidates = await findBuildOutputCandidates(root);
  const stale = candidates.filter((candidate) => isOlderThanDays(candidate.lastActivity, options.olderThanDays));

  console.log(`Root directory: ${root}`);

  if (stale.length === 0) {
    console.log("No stale build output directories found.");
    return;
  }

  const dirty = stale.filter((candidate) => hasUncommittedChanges(candidate.projectDir));
  const clean = stale.filter((candidate) => !hasUncommittedChanges(candidate.projectDir));

  if (clean.length === 0) {
    console.log("All stale build output directories belong to projects with uncommitted changes; skipping.");
    for (const candidate of dirty) {
      console.log(`  - Skipped ${candidate.buildOutputPath} (uncommitted changes in ${candidate.projectDir})`);
    }
    return;
  }

  const actions: PlannedAction[] = clean.map((candidate) => ({
    group: "Build output",
    description: `Delete ${candidate.buildOutputPath} (${candidate.buildTool}, last activity ${formatDate(candidate.lastActivity)})`,
  }));
  const footer = dirty.length > 0
    ? [`Skipped (uncommitted changes): ${dirty.map((candidate) => candidate.buildOutputPath).join(", ")}`]
    : [];

  if (options.dryRun) {
    printPlannedActions("DRY RUN build output cleanup plan:", actions, GROUP_ORDER, [
      ...footer,
      "No directories were deleted.",
      "Rerun without --dry-run to approve and apply this plan.",
    ]);
    return;
  }

  if (!options.yes) {
    printPlannedActions("Build output directories selected for cleanup:", actions, GROUP_ORDER, footer);
    const proceed = await confirmAction(`Delete ${clean.length} build output director${clean.length === 1 ? "y" : "ies"} listed above?`);
    if (!proceed) {
      console.log("Build output cleanup cancelled; nothing was changed.");
      return;
    }
  }

  const deleted: string[] = [];
  const failed: string[] = [];

  for (const candidate of clean) {
    try {
      await rm(candidate.buildOutputPath, { recursive: true, force: true });
      deleted.push(candidate.buildOutputPath);
    } catch (error) {
      failed.push(`${candidate.buildOutputPath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  console.log(`Deleted ${deleted.length} build output director${deleted.length === 1 ? "y" : "ies"}.`);
  if (dirty.length > 0) {
    console.log(`Skipped (uncommitted changes): ${dirty.map((candidate) => candidate.buildOutputPath).join(", ")}`);
  }
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(", ")}`);
  }
}
