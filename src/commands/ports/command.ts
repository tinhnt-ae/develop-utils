import { killHelp, runPortsKill } from "./kill.js";
import { listHelp, runPortsList } from "./list.js";

export function portsHelp(): string {
  return `Usage: devu ports <command> [options]

Commands:
  list  List processes listening on a TCP port.
  kill  Find and stop the process(es) listening on a TCP port.

Run "devu ports <command> --help" for command-specific options.`;
}

export async function runPorts(argv = process.argv.slice(2)): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === "-h" || command === "--help") {
    console.log(portsHelp());
    return;
  }

  if (command === "list") {
    await runPortsList(args);
    return;
  }

  if (command === "kill") {
    await runPortsKill(args);
    return;
  }

  if (command === "help:list") {
    console.log(listHelp());
    return;
  }

  if (command === "help:kill") {
    console.log(killHelp());
    return;
  }

  throw new Error(`Unknown ports command: ${command}`);
}
