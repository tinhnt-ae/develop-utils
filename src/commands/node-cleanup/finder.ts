import { stat } from "node:fs/promises";
import path from "node:path";
import { isGitRepository, runGit } from "../../shared/git.js";
import { walkDirectories } from "../../shared/fs-walk.js";

export interface NodeModulesCandidate {
  lastActivity: Date;
  nodeModulesPath: string;
  packageJsonPath: string;
  projectDir: string;
}

async function safeMtime(filePath: string): Promise<Date | undefined> {
  try {
    return (await stat(filePath)).mtime;
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

export async function findNodeModulesCandidates(root: string): Promise<NodeModulesCandidate[]> {
  const candidates: NodeModulesCandidate[] = [];

  for await (const dirPath of walkDirectories(root, {
    skip: [".git"],
    shouldRecurse: (_dirPath, name) => name !== "node_modules",
  })) {
    if (path.basename(dirPath) !== "node_modules") {
      continue;
    }

    const projectDir = path.dirname(dirPath);
    const packageJsonPath = path.join(projectDir, "package.json");
    const packageJsonMtime = await safeMtime(packageJsonPath);
    const nodeModulesMtime = await safeMtime(dirPath);

    if (!packageJsonMtime || !nodeModulesMtime) {
      continue;
    }

    const mtimeSignal = new Date(Math.max(nodeModulesMtime.getTime(), packageJsonMtime.getTime()));
    const gitSignal = gitLastCommitDate(projectDir);
    const lastActivity = gitSignal && gitSignal.getTime() > mtimeSignal.getTime() ? gitSignal : mtimeSignal;

    candidates.push({ lastActivity, nodeModulesPath: dirPath, packageJsonPath, projectDir });
  }

  return candidates;
}
