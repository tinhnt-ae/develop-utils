import path from "node:path";
import { formatDate, isOlderThanDays } from "../../shared/dates.js";
import { findBuildOutputCandidates } from "./build-finder.js";

interface BuildListOptions {
  help: boolean;
  olderThanDays: number;
  root?: string;
}

export function buildListHelp(): string {
  return `Usage: devu java-cleanup builds list --root dir [--older-than-days N]

Lists Maven/Gradle build output directories (target/, build/) under --root
with their staleness. A directory is STALE when the build output itself,
and (for a git project) its last commit, are older than the threshold.

Options:
  --root dir            Directory to scan. Required.
  --older-than-days N   Staleness threshold in days. Defaults to 14.`;
}

function parseBuildListArgs(argv: string[]): BuildListOptions {
  const options: BuildListOptions = { help: false, olderThanDays: 14 };

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

export async function runBuildList(argv = process.argv.slice(2)): Promise<void> {
  const options = parseBuildListArgs(argv);

  if (options.help) {
    console.log(buildListHelp());
    return;
  }

  const root = requireRoot(options.root);
  const candidates = await findBuildOutputCandidates(root);

  console.log(`Root directory: ${root}`);
  console.log("");

  if (candidates.length === 0) {
    console.log("No Maven/Gradle build output directories found.");
    return;
  }

  for (const candidate of candidates) {
    const stale = isOlderThanDays(candidate.lastActivity, options.olderThanDays);
    console.log(`${candidate.projectDir}\t${candidate.buildTool}\tlast activity ${formatDate(candidate.lastActivity)}${stale ? " (STALE)" : ""}`);
  }
}
