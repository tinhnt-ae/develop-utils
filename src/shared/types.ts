export interface ProjectOptions {
  dryRun: boolean;
  help: boolean;
  mode: string;
  projectDir: string;
  projectName: string;
}

export type PackageManager = "npm" | "pnpm" | "yarn";

export type GitProvider = "github" | "gitlab" | "bitbucket";

export interface GitMetadata {
  name: string;
  email: string;
  remoteUrl: string;
  githubUsername: string;
}
