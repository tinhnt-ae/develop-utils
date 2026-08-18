import { stat } from "node:fs/promises";
import path from "node:path";
import { walkDirectories } from "../../shared/fs-walk.js";
import { isGitRepository, runGit } from "../../shared/git.js";

export interface BuildOutputCandidate {
  buildOutputPath: string;
  buildTool: "gradle" | "maven";
  lastActivity: Date;
  projectDir: string;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function detectBuildTool(projectDir: string): Promise<"gradle" | "maven" | undefined> {
  if (await pathExists(path.join(projectDir, "pom.xml"))) {
    return "maven";
  }
  if (await pathExists(path.join(projectDir, "build.gradle")) || await pathExists(path.join(projectDir, "build.gradle.kts"))) {
    return "gradle";
  }
  return undefined;
}

async function safeMtime(target: string): Promise<Date | undefined> {
  try {
    return (await stat(target)).mtime;
  } catch {
    return undefined;
  }
}

function gitLastCommitDate(projectDir: string): Date | undefined {
  if (!isGitRepository(projectDir)) {
    return undefined;
  }

  const epochSeconds = runGit(projectDir, ["log", "-1", "--format=%ct"]);
  if (!epochSeconds) {
    return undefined;
  }

  const date = new Date(Number(epochSeconds) * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function hasUncommittedChanges(projectDir: string): boolean {
  if (!isGitRepository(projectDir)) {
    return false;
  }
  return runGit(projectDir, ["status", "--porcelain"]) !== "";
}

export async function findBuildOutputCandidates(root: string): Promise<BuildOutputCandidate[]> {
  const candidates: BuildOutputCandidate[] = [];

  for await (const dirPath of walkDirectories(root, {
    skip: [".git", "node_modules"],
    shouldRecurse: (_dirPath, name) => name !== "target" && name !== "build",
  })) {
    const name = path.basename(dirPath);
    if (name !== "target" && name !== "build") {
      continue;
    }

    const projectDir = path.dirname(dirPath);
    const buildTool = await detectBuildTool(projectDir);
    if (!buildTool) {
      continue;
    }

    const mtime = await safeMtime(dirPath);
    if (!mtime) {
      continue;
    }

    const gitSignal = gitLastCommitDate(projectDir);
    const lastActivity = gitSignal && gitSignal.getTime() > mtime.getTime() ? gitSignal : mtime;

    candidates.push({ buildOutputPath: dirPath, buildTool, lastActivity, projectDir });
  }

  return candidates;
}
