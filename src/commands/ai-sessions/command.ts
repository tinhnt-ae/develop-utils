import { cleanHelp, runAiSessionsClean } from "./clean.js";
import { listHelp, runAiSessionsList } from "./list.js";

export function aiSessionsHelp(): string {
  return `Usage: devu ai-sessions <command> [options]

Commands:
  list   List AI agent session files with size and staleness.
  clean  Delete AI agent session files that are stale and safe to remove.

Run "devu ai-sessions <command> --help" for command-specific options.`;
}

export async function runAiSessions(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(aiSessionsHelp());
    return;
  }

  if (command === "list") {
    await runAiSessionsList(args);
    return;
  }

  if (command === "clean") {
    await runAiSessionsClean(args);
    return;
  }

  if (command === "help:list") {
    console.log(listHelp());
    return;
  }

  if (command === "help:clean") {
    console.log(cleanHelp());
    return;
  }

  throw new Error(`Unknown ai-sessions command: ${command}`);
}
