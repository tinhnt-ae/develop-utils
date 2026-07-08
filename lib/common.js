import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export function parseCommonArgs(argv) {
  const options = {
    dryRun: false,
    help: false,
    mode: "auto",
    projectDir: process.cwd(),
    projectName: undefined,
  };

  const positional = [];

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

  options.projectDir = path.resolve(options.projectDir);
  options.projectName = options.projectName || path.basename(options.projectDir);

  return options;
}

export function runGit(projectDir, args, fallback = "") {
  try {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

export function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "inherit"],
  }).trim();
}

export function isGitRepository(projectDir) {
  return runGit(projectDir, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

export function parseGitHubUsername(remoteUrl) {
  if (!remoteUrl) {
    return "";
  }

  const normalized = remoteUrl
    .replace(/^git@[^:]+:/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/\.git$/, "");

  const [owner] = normalized.split("/");
  return owner || "";
}

export function detectProvider(remoteUrl) {
  const lower = remoteUrl.toLowerCase();

  if (lower.includes("github")) {
    return "github";
  }
  if (lower.includes("gitlab")) {
    return "gitlab";
  }
  if (lower.includes("bitbucket")) {
    return "bitbucket";
  }

  return "";
}

export function detectDefaultBranch(projectDir) {
  const originHead = runGit(projectDir, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);

  if (originHead) {
    return originHead.replace(/^origin\//, "");
  }

  return runGit(projectDir, ["branch", "--show-current"], "main") || "main";
}

export function getGitMetadata(projectDir) {
  const name = runGit(projectDir, ["config", "--get", "user.name"]);
  const email = runGit(projectDir, ["config", "--get", "user.email"]);
  const remoteUrl = runGit(projectDir, ["remote", "get-url", "origin"]);

  return {
    name,
    email,
    remoteUrl,
    githubUsername: parseGitHubUsername(remoteUrl),
  };
}

export function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

export function today() {
  return new Date();
}

export function getFirstCommitDate(projectDir) {
  const raw = runGit(projectDir, ["log", "--reverse", "--format=%ad", "--date=iso-strict"]);

  if (!raw) {
    return undefined;
  }

  const [firstLine] = raw.split("\n");
  const date = new Date(firstLine);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function detectPackageManager(projectDir) {
  const packageJsonPath = path.join(projectDir, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const packageManager = execFileSync(process.execPath, [
        "-e",
        "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write((pkg.packageManager||'').split('@')[0]);",
        packageJsonPath,
      ], { encoding: "utf8" });

      if (["pnpm", "npm", "yarn"].includes(packageManager)) {
        return packageManager;
      }
    } catch {
      // Fall through to lockfile detection.
    }
  }

  if (existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(projectDir, "package-lock.json")) || existsSync(path.join(projectDir, "npm-shrinkwrap.json"))) {
    return "npm";
  }
  if (existsSync(path.join(projectDir, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

export async function ensureDir(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}
