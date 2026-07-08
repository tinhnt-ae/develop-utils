import { execFileSync } from "node:child_process";
import type { GitMetadata, GitProvider } from "./types.js";

export function runGit(projectDir: string, args: string[], fallback = ""): string {
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

export function isGitRepository(projectDir: string): boolean {
  return runGit(projectDir, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

export function parseGitHubUsername(remoteUrl: string): string {
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

export function detectProvider(remoteUrl: string): GitProvider | undefined {
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

  return undefined;
}

export function detectDefaultBranch(projectDir: string): string {
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

export function getGitMetadata(projectDir: string): GitMetadata {
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

export function getFirstCommitDate(projectDir: string): Date | undefined {
  const raw = runGit(projectDir, ["log", "--reverse", "--format=%ad", "--date=iso-strict"]);

  if (!raw) {
    return undefined;
  }

  const [firstLine] = raw.split("\n");
  const date = new Date(firstLine);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

