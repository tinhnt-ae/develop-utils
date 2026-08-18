import { homedir } from "node:os";
import { formatBytes } from "../../shared/bytes.js";
import { formatDate, isOlderThanDays } from "../../shared/dates.js";
import { DEFAULT_PROVIDERS, discoverSessions } from "./discover.js";
import type { SessionProvider } from "./provider.js";

interface AiSessionsListOptions {
  help: boolean;
  olderThanDays: number;
  project?: string;
}

interface AiSessionsListDependencies {
  home?: string;
  providers?: SessionProvider[];
}

export function listHelp(): string {
  return `Usage: devu ai-sessions list [--older-than-days N] [--project name]

Lists AI agent session files (currently Claude Code session transcripts
under ~/.claude/projects) with their size and staleness.

Options:
  --older-than-days N  Staleness threshold in days. Defaults to 30.
  --project name       Only list sessions under this project directory name.`;
}

function parseListArgs(argv: string[]): AiSessionsListOptions {
  const options: AiSessionsListOptions = { help: false, olderThanDays: 30 };

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

export async function runAiSessionsList(
  argv = process.argv.slice(2),
  dependencies: AiSessionsListDependencies = {},
): Promise<void> {
  const options = parseListArgs(argv);

  if (options.help) {
    console.log(listHelp());
    return;
  }

  const home = dependencies.home || homedir();
  const providers = dependencies.providers || DEFAULT_PROVIDERS;
  const sessions = await discoverSessions(providers, home, options.project);

  console.log(`Home directory: ${home}`);
  console.log("");

  if (sessions.length === 0) {
    console.log("No AI agent sessions found.");
    return;
  }

  let totalBytes = 0;
  for (const session of sessions) {
    totalBytes += session.sizeBytes;
    const stale = isOlderThanDays(session.lastModified, options.olderThanDays);
    console.log(`${session.projectDir}/${session.sessionId}\t${formatBytes(session.sizeBytes)}\tlast modified ${formatDate(session.lastModified)}${stale ? " (STALE)" : ""}`);
  }

  console.log("");
  console.log(`Total: ${formatBytes(totalBytes)} across ${sessions.length} session${sessions.length === 1 ? "" : "s"}.`);
}
