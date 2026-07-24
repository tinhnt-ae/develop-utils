import { initHelp, runPgInit } from "./init.js";

export function pgHelp(): string {
  return `Usage: devu pg <command> [options]

Commands:
  init  Preview local PostgreSQL database provisioning for a project.

Run "devu pg <command> --help" for command-specific options.`;
}

export async function runPg(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(pgHelp());
    return;
  }

  if (command === "init") {
    await runPgInit(args);
    return;
  }

  if (command === "help:init") {
    console.log(initHelp());
    return;
  }

  throw new Error(`Unknown pg command: ${command}`);
}
