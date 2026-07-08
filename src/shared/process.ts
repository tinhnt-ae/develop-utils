import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

interface RunCommandOptions {
  cwd?: string;
  stdio?: ExecFileSyncOptions["stdio"];
}

export function runCommand(command: string, args: string[], options: RunCommandOptions = {}): string {
  const output = execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "inherit"],
  });

  return output === null ? "" : String(output).trim();
}
