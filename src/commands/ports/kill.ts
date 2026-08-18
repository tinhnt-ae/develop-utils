import { confirmAction } from "../../shared/prompts.js";
import { findProcessesOnPort } from "./lookup.js";

interface PortsKillOptions {
  dryRun: boolean;
  force: boolean;
  help: boolean;
  port?: number;
  yes: boolean;
}

interface PortsKillDependencies {
  findProcesses?: typeof findProcessesOnPort;
  killProcess?: (pid: number, signal: NodeJS.Signals) => void;
}

export function killHelp(): string {
  return `Usage: devu ports kill --port N [--dry-run] [--yes] [--force]

Finds and stops the process(es) listening on TCP port N. The CLI's own
process and pid 1 are never signaled.

Options:
  --port N    TCP port to inspect. Required.
  --dry-run   Print the process(es) that would be signaled without sending a signal.
  --yes       Send the signal without prompting for confirmation.
  --force     Send SIGKILL instead of SIGTERM.`;
}

function parseKillArgs(argv: string[]): PortsKillOptions {
  const options: PortsKillOptions = {
    dryRun: false,
    force: false,
    help: false,
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
    } else if (arg === "--port") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--port requires a value");
      }
      options.port = Number(argv[i]);
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    } else {
      throw new Error(`Unsupported option: ${arg}`);
    }
  }

  return options;
}

function validatePort(port: number | undefined): number {
  if (port === undefined) {
    throw new Error("--port is required");
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  return port;
}

export async function runPortsKill(argv = process.argv.slice(2), dependencies: PortsKillDependencies = {}): Promise<void> {
  const options = parseKillArgs(argv);

  if (options.help) {
    console.log(killHelp());
    return;
  }

  const port = validatePort(options.port);
  const findProcesses = dependencies.findProcesses || findProcessesOnPort;
  const killProcess = dependencies.killProcess || ((pid, signal) => {
    process.kill(pid, signal);
  });

  const matches = findProcesses(port);

  if (matches.length === 0) {
    console.log(`No process is listening on port ${port}.`);
    return;
  }

  const isProtected = (pid: number) => pid <= 1 || pid === process.pid;
  const killable = matches.filter((match) => !isProtected(match.pid));

  console.log(`Port ${port}:`);
  for (const match of matches) {
    const note = isProtected(match.pid) ? " (protected, will not be signaled)" : "";
    console.log(`  - pid ${match.pid} (${match.command})${note}`);
  }

  if (killable.length === 0) {
    console.log("");
    console.log("No process on this port can be signaled.");
    return;
  }

  const signal: NodeJS.Signals = options.force ? "SIGKILL" : "SIGTERM";

  if (options.dryRun) {
    console.log("");
    console.log(`DRY RUN: would send ${signal} to ${killable.length} process(es) listed above.`);
    console.log("Rerun without --dry-run to approve and apply this plan.");
    return;
  }

  if (!options.yes) {
    const proceed = await confirmAction(`Send ${signal} to ${killable.length} process(es) listed above?`);
    if (!proceed) {
      console.log("Port kill cancelled; nothing was changed.");
      return;
    }
  }

  const failures: string[] = [];
  for (const match of killable) {
    try {
      killProcess(match.pid, signal);
    } catch (error) {
      failures.push(`${match.pid} (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const succeeded = killable.length - failures.length;
  console.log(`Signaled ${succeeded} of ${killable.length} process(es) with ${signal}.`);
  if (failures.length > 0) {
    console.log(`Failed: ${failures.join(", ")}`);
  }
}
