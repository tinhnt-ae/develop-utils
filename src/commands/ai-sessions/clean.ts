import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { formatBytes } from "../../shared/bytes.js";
import { formatDate, isOlderThanDays } from "../../shared/dates.js";
import { type PlannedAction, printPlannedActions } from "../../shared/plan.js";
import { confirmAction } from "../../shared/prompts.js";
import { DEFAULT_PROVIDERS, discoverSessions } from "./discover.js";
import type { SessionProvider } from "./provider.js";

interface AiSessionsCleanOptions {
  dryRun: boolean;
  help: boolean;
  olderThanDays: number;
  project?: string;
  yes: boolean;
}

interface AiSessionsCleanDependencies {
  home?: string;
  providers?: SessionProvider[];
}

const GROUP_ORDER = ["Sessions"];

export function cleanHelp(): string {
  return `Usage: devu ai-sessions clean [--older-than-days N] [--project name] [--dry-run] [--yes]

Deletes AI agent session files (currently Claude Code session transcripts
under ~/.claude/projects) whose last modification is older than the
threshold. Only discovered session files are ever deleted.

Options:
  --older-than-days N  Staleness threshold in days. Defaults to 30.
  --project name       Only clean sessions under this project directory name.
  --dry-run            Print the sessions that would be deleted without deleting them.
  --yes                Delete without prompting for confirmation.`;
}

function parseCleanArgs(argv: string[]): AiSessionsCleanOptions {
  const options: AiSessionsCleanOptions = {
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
    } else if (arg === "--older-than-days") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--older-than-days requires a value");
      }
      options.olderThanDays = Number(argv[i]);
    } else if (arg.startsWith("--older-than-days=")) {
      options.olderThanDays = Number(arg.slice("--older-than-days=".length));
    } else if (arg === "--project") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--project requires a value");
      }
      options.project = argv[i];
    } else if (arg.startsWith("--project=")) {
      options.project = arg.slice("--project=".length);
    } else {
      throw new Error(`Unsupported option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.olderThanDays) || options.olderThanDays < 0) {
    throw new Error("--older-than-days must be a non-negative number");
  }

  return options;
}

export async function runAiSessionsClean(
  argv = process.argv.slice(2),
  dependencies: AiSessionsCleanDependencies = {},
): Promise<void> {
  const options = parseCleanArgs(argv);

  if (options.help) {
    console.log(cleanHelp());
    return;
  }

  const home = dependencies.home || homedir();
  const providers = dependencies.providers || DEFAULT_PROVIDERS;
  const sessions = await discoverSessions(providers, home, options.project);
  const stale = sessions.filter((session) => isOlderThanDays(session.lastModified, options.olderThanDays));

  console.log(`Home directory: ${home}`);

  if (stale.length === 0) {
    console.log("No stale AI agent sessions found.");
    return;
  }

  const totalBytes = stale.reduce((sum, session) => sum + session.sizeBytes, 0);
  const actions: PlannedAction[] = stale.map((session) => ({
    group: "Sessions",
    description: `Delete ${session.filePath} (${formatBytes(session.sizeBytes)}, last modified ${formatDate(session.lastModified)})`,
  }));

  if (options.dryRun) {
    printPlannedActions("DRY RUN AI session cleanup plan:", actions, GROUP_ORDER, [
      `Total reclaimable: ${formatBytes(totalBytes)}.`,
      "No sessions were deleted.",
      "Rerun without --dry-run to approve and apply this plan.",
    ]);
    return;
  }

  if (!options.yes) {
    printPlannedActions(`AI agent sessions selected for cleanup (${formatBytes(totalBytes)} total):`, actions, GROUP_ORDER);
    const proceed = await confirmAction(`Delete ${stale.length} session file(s) listed above?`);
    if (!proceed) {
      console.log("AI session cleanup cancelled; nothing was changed.");
      return;
    }
  }

  const deleted: string[] = [];
  const failed: string[] = [];
  let deletedBytes = 0;

  for (const session of stale) {
    try {
      await unlink(session.filePath);
      deleted.push(session.filePath);
      deletedBytes += session.sizeBytes;
    } catch (error) {
      failed.push(`${session.filePath} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  console.log(`Deleted ${deleted.length} session file(s), reclaiming ${formatBytes(deletedBytes)}.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(", ")}`);
  }
}
