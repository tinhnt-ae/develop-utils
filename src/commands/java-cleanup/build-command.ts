import { buildCleanHelp, runBuildClean } from "./build-clean.js";
import { buildListHelp, runBuildList } from "./build-list.js";

export function buildsHelp(): string {
  return `Usage: devu java-cleanup builds <command> [options]

Commands:
  list   List Maven/Gradle build output directories with staleness.
  clean  Delete Maven/Gradle build output directories that are stale.

Run "devu java-cleanup builds <command> --help" for command-specific options.`;
}

export async function runBuilds(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(buildsHelp());
    return;
  }

  if (command === "list") {
    await runBuildList(args);
    return;
  }

  if (command === "clean") {
    await runBuildClean(args);
    return;
  }

  if (command === "help:list") {
    console.log(buildListHelp());
    return;
  }

  if (command === "help:clean") {
    console.log(buildCleanHelp());
    return;
  }

  throw new Error(`Unknown builds command: ${command}`);
}
