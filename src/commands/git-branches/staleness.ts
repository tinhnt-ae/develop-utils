import { isOlderThanDays } from "../../shared/dates.js";
import { runGit } from "../../shared/git.js";

export interface BranchInfo {
  isCurrent: boolean;
  lastCommitDate: Date;
  merged: boolean;
  name: string;
  upstreamGone: boolean;
}

export function listLocalBranches(projectDir: string, defaultBranch: string): BranchInfo[] {
  const currentBranch = runGit(projectDir, ["branch", "--show-current"]);
  const format = "%(refname:short)\t%(committerdate:iso-strict)\t%(upstream:track)";
  const raw = runGit(projectDir, ["for-each-ref", "refs/heads", `--format=${format}`]);

  if (!raw) {
    return [];
  }

  const mergedRaw = runGit(projectDir, ["branch", "--merged", defaultBranch, "--format=%(refname:short)"]);
  const mergedNames = new Set(mergedRaw.split("\n").filter(Boolean));

  return raw.split("\n").filter(Boolean).map((line) => {
    const [name, committerDate, track] = line.split("\t");

    return {
      isCurrent: name === currentBranch,
      lastCommitDate: new Date(committerDate),
      merged: mergedNames.has(name),
      name,
      upstreamGone: track === "[gone]",
    };
  });
}

export function isStaleBranch(
  branch: BranchInfo,
  defaultBranch: string,
  olderThanDays: number,
  protect: string[],
): boolean {
  if (branch.isCurrent || branch.name === defaultBranch || protect.includes(branch.name)) {
    return false;
  }

  if (!branch.merged && !branch.upstreamGone) {
    return false;
  }

  return isOlderThanDays(branch.lastCommitDate, olderThanDays);
}
