import { jdkCleanHelp, runJdkClean } from "./jdk-clean.js";
import { jdkListHelp, runJdkList } from "./jdk-list.js";

export function jdksHelp(): string {
  return `Usage: devu java-cleanup jdks <command> [options]

Commands:
  list   List installed JDKs and which one is active.
  clean  Delete installed JDKs that are not active and not kept.

Run "devu java-cleanup jdks <command> --help" for command-specific options.`;
}

export async function runJdks(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(jdksHelp());
    return;
  }

  if (command === "list") {
    await runJdkList(args);
    return;
  }

  if (command === "clean") {
    await runJdkClean(args);
    return;
  }

  if (command === "help:list") {
    console.log(jdkListHelp());
    return;
  }

  if (command === "help:clean") {
    console.log(jdkCleanHelp());
    return;
  }

  throw new Error(`Unknown jdks command: ${command}`);
}
