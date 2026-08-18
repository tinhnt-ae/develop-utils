import { buildsHelp, runBuilds } from "./build-command.js";
import { jdksHelp, runJdks } from "./jdk-command.js";

export function javaCleanupHelp(): string {
  return `Usage: devu java-cleanup <command> [options]

Commands:
  jdks    List and delete installed JDKs via sdkman, jenv, or jabba.
  builds  List and delete stale Maven/Gradle build output directories.

Run "devu java-cleanup <command> --help" for command-specific options.`;
}

export async function runJavaCleanup(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(javaCleanupHelp());
    return;
  }

  if (command === "jdks") {
    await runJdks(args);
    return;
  }

  if (command === "builds") {
    await runBuilds(args);
    return;
  }

  if (command === "help:jdks") {
    console.log(jdksHelp());
    return;
  }

  if (command === "help:builds") {
    console.log(buildsHelp());
    return;
  }

  throw new Error(`Unknown java-cleanup command: ${command}`);
}
