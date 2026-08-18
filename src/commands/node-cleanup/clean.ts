import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { formatBytes } from "../../shared/bytes.js";
import { formatDate, isOlderThanDays } from "../../shared/dates.js";
import { type PlannedAction, printPlannedActions } from "../../shared/plan.js";
import { confirmAction } from "../../shared/prompts.js";
import { findNodeModulesCandidates } from "./finder.js";
import { requireRoot } from "./list.js";
import { directorySizeBytes } from "./size.js";

interface NodeCleanupCleanOptions {
  dryRun: boolean;
  help: boolean;
  olderThanDays: number;
  root?: string;
  yes: boolean;
}

const GROUP_ORDER = ["node_modules"];

export function cleanHelp(): string {
  return `Usage: devu node-cleanup clean --root dir [--older-than-days N] [--dry-run] [--yes]

Deletes node_modules directories under --root whose node_modules directory,
sibling package.json, and (for a git project) last commit are all older
than --older-than-days.

Options:
  --root dir             Directory to scan. Required.
  --older-than-days N    Staleness threshold in days. Defaults to 30.
  --dry-run              Print the directories that would be deleted without deleting them.
  --yes                  Delete without prompting for confirmation.`;
}

function parseCleanArgs(argv: string[]): NodeCleanupCleanOptions {
  const options: NodeCleanupCleanOptions = {
    dryRun: false,
    help: false,
    olderThanDays: 30,
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

function guardRoot(root: string): void {
  if (root === path.parse(root).root) {
    throw new Error(`Refusing to scan filesystem root ${root}; pass a more specific --root.`);
  }
  if (root === path.resolve(os.homedir())) {
    throw new Error(`Refusing to scan home directory ${root}; pass a more specific --root.`);
  }
}

export async function runNodeCleanupClean(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCleanArgs(argv);

  if (options.help) {
    console.log(cleanHelp());
    return;
  }

  const root = requireRoot(options.root);
  guardRoot(root);

  const candidates = await findNodeModulesCandidates(root);
  const stale = candidates.filter((candidate) => isOlderThanDays(candidate.lastActivity, options.olderThanDays));

  console.log(`Root directory: ${root}`);

  if (stale.length === 0) {
    console.log("No stale node_modules directories found.");
    return;
  }

  const sizes = new Map<string, number>();
  let totalBytes = 0;
  for (const candidate of stale) {
    const size = await directorySizeBytes(candidate.nodeModulesPath);
    sizes.set(candidate.nodeModulesPath, size);
    totalBytes += size;
  }

  const actions: PlannedAction[] = stale.map((candidate) => ({
    group: "node_modules",
    description: `Delete ${candidate.nodeModulesPath} (${formatBytes(sizes.get(candidate.nodeModulesPath) ?? 0)}, last activity ${formatDate(candidate.lastActivity)})`,
  }));

  if (options.dryRun) {
    printPlannedActions("DRY RUN node_modules cleanup plan:", actions, GROUP_ORDER, [
      `Total reclaimable: ${formatBytes(totalBytes)}.`,
      "No directories were deleted.",
      "Rerun without --dry-run to approve and apply this plan.",
    ]);
    return;
  }

  if (!options.yes) {
    printPlannedActions(`node_modules directories selected for cleanup (${formatBytes(totalBytes)} total):`, actions, GROUP_ORDER);
    const proceed = await confirmAction(`Delete ${stale.length} node_modules director${stale.length === 1 ? "y" : "ies"} listed above?`);
    if (!proceed) {
      console.log("node_modules cleanup cancelled; nothing was changed.");
      return;
    }
  }

  const deleted: string[] = [];
  const failed: string[] = [];
  let deletedBytes = 0;

  for (const candidate of stale) {
    try {
      await rm(candidate.nodeModulesPath, { recursive: true, force: true });
      deleted.push(candidate.nodeModulesPath);
      deletedBytes += sizes.get(candidate.nodeModulesPath) ?? 0;
    } catch (error) {
      failed.push(`${candidate.nodeModulesPath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  console.log(`Deleted ${deleted.length} node_modules director${deleted.length === 1 ? "y" : "ies"}, reclaiming ${formatBytes(deletedBytes)}.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(", ")}`);
  }
}
