import path from "node:path";
import { formatDate, isOlderThanDays } from "../../shared/dates.js";
import { findNodeModulesCandidates } from "./finder.js";
import { directorySizeBytes, formatBytes } from "./size.js";

interface NodeCleanupListOptions {
  help: boolean;
  olderThanDays: number;
  root?: string;
}

export function listHelp(): string {
  return `Usage: devu node-cleanup list --root dir [--older-than-days N]

Lists node_modules directories under --root with their reclaimable size and
staleness. A directory is STALE when the node_modules directory itself, its
sibling package.json, and (for a git project) its last commit are all
older than the threshold.

Options:
  --root dir            Directory to scan. Required.
  --older-than-days N   Staleness threshold in days. Defaults to 30.`;
}

function parseListArgs(argv: string[]): NodeCleanupListOptions {
  const options: NodeCleanupListOptions = { help: false, olderThanDays: 30 };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
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

export function requireRoot(root: string | undefined): string {
  if (!root) {
    throw new Error("--root is required");
  }
  return path.resolve(root);
}

export async function runNodeCleanupList(argv = process.argv.slice(2)): Promise<void> {
  const options = parseListArgs(argv);

  if (options.help) {
    console.log(listHelp());
    return;
  }

  const root = requireRoot(options.root);
  const candidates = await findNodeModulesCandidates(root);

  console.log(`Root directory: ${root}`);
  console.log("");

  if (candidates.length === 0) {
    console.log("No node_modules directories found.");
    return;
  }

  let totalBytes = 0;

  for (const candidate of candidates) {
    const size = await directorySizeBytes(candidate.nodeModulesPath);
    totalBytes += size;
    const stale = isOlderThanDays(candidate.lastActivity, options.olderThanDays);
    console.log(`${candidate.projectDir}\t${formatBytes(size)}\tlast activity ${formatDate(candidate.lastActivity)}${stale ? " (STALE)" : ""}`);
  }

  console.log("");
  console.log(`Total: ${formatBytes(totalBytes)} across ${candidates.length} node_modules director${candidates.length === 1 ? "y" : "ies"}.`);
}
