import { findProcessesOnPort } from "./lookup.js";

interface PortsListOptions {
  help: boolean;
  port?: number;
}

interface PortsListDependencies {
  findProcesses?: typeof findProcessesOnPort;
}

export function listHelp(): string {
  return `Usage: devu ports list --port N

Lists processes currently listening on TCP port N.

Options:
  --port N   TCP port to inspect. Required.`;
}

function parseListArgs(argv: string[]): PortsListOptions {
  const options: PortsListOptions = { help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
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

export async function runPortsList(argv = process.argv.slice(2), dependencies: PortsListDependencies = {}): Promise<void> {
  const options = parseListArgs(argv);

  if (options.help) {
    console.log(listHelp());
    return;
  }

  const port = validatePort(options.port);
  const findProcesses = dependencies.findProcesses || findProcessesOnPort;
  const matches = findProcesses(port);

  if (matches.length === 0) {
    console.log(`No process is listening on port ${port}.`);
    return;
  }

  console.log(`Port ${port}:`);
  for (const match of matches) {
    console.log(`  - pid ${match.pid} (${match.command})`);
  }
}
