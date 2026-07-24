import { execFileSync, type ExecFileSyncOptions } from "node:child_process";

interface RunCommandOptions {
  cwd?: string;
  input?: string;
  stdio?: ExecFileSyncOptions["stdio"];
}

export function runCommand(command: string, args: string[], options: RunCommandOptions = {}): string {
  const output = execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    input: options.input,
    stdio: options.stdio || [options.input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  });

  return output === null ? "" : String(output).trim();
}
