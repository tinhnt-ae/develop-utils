import { cleanHelp, runNodeCleanupClean } from "./clean.js";
import { listHelp, runNodeCleanupList } from "./list.js";

export function nodeCleanupHelp(): string {
  return `Usage: devu node-cleanup <command> [options]

Commands:
  list   List node_modules directories with reclaimable size and staleness.
  clean  Delete node_modules directories that are stale and safe to remove.

Run "devu node-cleanup <command> --help" for command-specific options.`;
}

export async function runNodeCleanup(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(nodeCleanupHelp());
    return;
  }

  if (command === "list") {
    await runNodeCleanupList(args);
    return;
  }

  if (command === "clean") {
    await runNodeCleanupClean(args);
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

  throw new Error(`Unknown node-cleanup command: ${command}`);
}
