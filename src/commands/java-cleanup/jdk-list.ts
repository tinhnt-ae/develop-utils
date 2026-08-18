import { homedir } from "node:os";
import { detectManager } from "./jdk-managers.js";

interface JdkListOptions {
  help: boolean;
  manager?: string;
}

interface JdkListDependencies {
  home?: string;
}

export function jdkListHelp(): string {
  return `Usage: devu java-cleanup jdks list [--manager sdkman|jenv|jabba]

Lists installed JDKs for the detected (or specified) version manager, and
which one is currently active.

Options:
  --manager name   Java version manager to inspect. Auto-detected when omitted.`;
}

function parseJdkListArgs(argv: string[]): JdkListOptions {
  const options: JdkListOptions = { help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--manager") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--manager requires a value");
      }
      options.manager = argv[i];
    } else if (arg.startsWith("--manager=")) {
      options.manager = arg.slice("--manager=".length);
    } else {
      throw new Error(`Unsupported option: ${arg}`);
    }
  }

  return options;
}

export function guardJdkPlatform(): void {
  if (process.platform === "win32") {
    throw new Error("devu java-cleanup jdks is not supported on Windows yet.");
  }
}

export async function runJdkList(argv = process.argv.slice(2), dependencies: JdkListDependencies = {}): Promise<void> {
  const options = parseJdkListArgs(argv);

  if (options.help) {
    console.log(jdkListHelp());
    return;
  }

  guardJdkPlatform();

  const home = dependencies.home || homedir();
  const manager = await detectManager(home, options.manager);
  const versions = await manager.listInstalledVersions(home);
  const active = await manager.getActiveVersion(home);

  console.log(`Manager: ${manager.id}`);
  console.log(`Candidates root: ${manager.candidatesRoot(home)}`);
  console.log(`Active version: ${active || "unknown"}`);
  console.log("");

  if (versions.length === 0) {
    console.log("No installed JDKs found.");
    return;
  }

  for (const version of versions) {
    console.log(`${version}${version === active ? " (active)" : ""}`);
  }
}
