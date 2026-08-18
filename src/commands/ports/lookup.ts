import { execFileSync } from "node:child_process";

export interface PortProcess {
  command: string;
  pid: number;
}

function findProcessesOnPortPosix(port: number): PortProcess[] {
  let stdout: string;

  try {
    stdout = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    const status = (error as NodeJS.ErrnoException & { status?: number }).status;
    if (status === 1) {
      return [];
    }
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("lsof is required to look up processes by port; install it and try again.");
    }
    throw error;
  }

  const processes = new Map<number, PortProcess>();

  for (const line of stdout.trim().split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/);
    const command = columns[0];
    const pid = Number(columns[1]);

    if (!command || !Number.isInteger(pid)) {
      continue;
    }

    processes.set(pid, { command, pid });
  }

  return [...processes.values()];
}

function findProcessesOnPortWindows(port: number): PortProcess[] {
  let stdout: string;

  try {
    stdout = execFileSync("netstat", ["-ano", "-p", "TCP"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("netstat is required to look up processes by port; install it and try again.");
    }
    throw error;
  }

  const pids = new Set<number>();

  for (const line of stdout.split("\n")) {
    const columns = line.trim().split(/\s+/);

    if (columns[0] !== "TCP" || columns.length < 5) {
      continue;
    }

    const [, localAddress, , state, pidText] = columns;
    const pid = Number(pidText);
    const portMatch = /:(\d+)$/.exec(localAddress);

    if (state !== "LISTENING" || !portMatch || Number(portMatch[1]) !== port || !Number.isInteger(pid)) {
      continue;
    }

    pids.add(pid);
  }

  return [...pids].map((pid) => ({ command: "unknown", pid }));
}

export function findProcessesOnPort(port: number): PortProcess[] {
  return process.platform === "win32" ? findProcessesOnPortWindows(port) : findProcessesOnPortPosix(port);
}
