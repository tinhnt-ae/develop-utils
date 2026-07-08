import path from "node:path";
import type { ProjectOptions } from "./types.js";

export function parseCommonArgs(argv: string[]): ProjectOptions {
  const options: Omit<ProjectOptions, "projectName"> & { projectName?: string } = {
    dryRun: false,
    help: false,
    mode: "auto",
    projectDir: process.cwd(),
    projectName: undefined,
  };

  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--mode") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--mode requires a value");
      }
      options.mode = argv[i];
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.slice("--mode=".length);
    } else if (arg === "--project-name") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--project-name requires a value");
      }
      options.projectName = argv[i];
    } else if (arg.startsWith("--project-name=")) {
      options.projectName = arg.slice("--project-name=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error("Only one project-dir argument is supported");
  }

  if (positional[0]) {
    options.projectDir = positional[0];
  }

  const projectDir = path.resolve(options.projectDir);
  const projectName = options.projectName || path.basename(projectDir);

  return {
    ...options,
    projectDir,
    projectName,
  };
}
