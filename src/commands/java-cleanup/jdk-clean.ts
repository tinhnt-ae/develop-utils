import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { type PlannedAction, printPlannedActions } from "../../shared/plan.js";
import { confirmAction } from "../../shared/prompts.js";
import { detectManager } from "./jdk-managers.js";
import { guardJdkPlatform } from "./jdk-list.js";

interface JdkCleanOptions {
  dryRun: boolean;
  force: boolean;
  help: boolean;
  keep: string[];
  manager?: string;
  yes: boolean;
}

interface JdkCleanDependencies {
  home?: string;
}

const GROUP_ORDER = ["JDKs"];

export function jdkCleanHelp(): string {
  return `Usage: devu java-cleanup jdks clean [--manager sdkman|jenv|jabba] [--keep version] [--dry-run] [--yes] [--force]

Deletes installed JDKs that are not the active version and not passed via
--keep. The active version is never deleted, even with --force. If the
active version cannot be determined, --force is required to proceed at all
(as a safety fallback, since an undetectable active version cannot be
protected automatically).

Options:
  --manager name   Java version manager to inspect. Auto-detected when omitted.
  --keep version   JDK version to never delete. Repeatable.
  --dry-run        Print the JDKs that would be deleted without deleting them.
  --yes            Delete without prompting for confirmation.
  --force          Proceed even when the active version could not be determined.`;
}

function parseJdkCleanArgs(argv: string[]): JdkCleanOptions {
  const options: JdkCleanOptions = {
    dryRun: false,
    force: false,
    help: false,
    keep: [],
    yes: false,
  };

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
    } else if (arg === "--manager") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--manager requires a value");
      }
      options.manager = argv[i];
    } else if (arg.startsWith("--manager=")) {
      options.manager = arg.slice("--manager=".length);
    } else if (arg === "--keep") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--keep requires a value");
      }
      options.keep.push(argv[i]);
    } else if (arg.startsWith("--keep=")) {
      options.keep.push(arg.slice("--keep=".length));
    } else {
      throw new Error(`Unsupported option: ${arg}`);
    }
  }

  return options;
}

export async function runJdkClean(argv = process.argv.slice(2), dependencies: JdkCleanDependencies = {}): Promise<void> {
  const options = parseJdkCleanArgs(argv);

  if (options.help) {
    console.log(jdkCleanHelp());
    return;
  }

  guardJdkPlatform();

  const home = dependencies.home || homedir();
  const manager = await detectManager(home, options.manager);
  const candidatesRoot = path.resolve(manager.candidatesRoot(home));
  const versions = await manager.listInstalledVersions(home);
  const active = await manager.getActiveVersion(home);

  console.log(`Manager: ${manager.id}`);
  console.log(`Candidates root: ${candidatesRoot}`);
  console.log(`Active version: ${active || "unknown"}`);

  if (!active && !options.force) {
    throw new Error(`Could not determine the active ${manager.id} version; rerun with --force to proceed. Use --keep to protect specific versions.`);
  }

  const toDelete = versions.filter((version) => version !== active && !options.keep.includes(version));

  if (toDelete.length === 0) {
    console.log("No JDKs to remove.");
    return;
  }

  const actions: PlannedAction[] = toDelete.map((version) => ({
    group: "JDKs",
    description: `Delete ${manager.id} JDK "${version}" (${path.join(candidatesRoot, version)})`,
  }));

  if (options.dryRun) {
    printPlannedActions("DRY RUN JDK cleanup plan:", actions, GROUP_ORDER, [
      "No JDKs were deleted.",
      "Rerun without --dry-run to approve and apply this plan.",
    ]);
    return;
  }

  if (!options.yes) {
    printPlannedActions("JDKs selected for cleanup:", actions, GROUP_ORDER);
    const proceed = await confirmAction(`Delete ${toDelete.length} JDK(s) listed above?`);
    if (!proceed) {
      console.log("JDK cleanup cancelled; nothing was changed.");
      return;
    }
  }

  const deleted: string[] = [];
  const failed: string[] = [];

  for (const version of toDelete) {
    const targetPath = path.resolve(candidatesRoot, version);

    if (version === active || !targetPath.startsWith(`${candidatesRoot}${path.sep}`)) {
      failed.push(`${version} (refused: outside the candidates root or is the active version)`);
      continue;
    }

    try {
      await rm(targetPath, { recursive: true, force: true });
      deleted.push(version);
    } catch (error) {
      failed.push(`${version} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  console.log(`Deleted ${deleted.length} JDK(s): ${deleted.length > 0 ? deleted.join(", ") : "none"}.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(", ")}`);
  }
}
