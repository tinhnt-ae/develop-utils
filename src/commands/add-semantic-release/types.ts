import type { GitProvider, PackageManager } from "../../shared/types.js";

export type SemanticReleaseMode = "auto" | "ci-npx" | "local-node";

export type ResolvedSemanticReleaseMode = Exclude<SemanticReleaseMode, "auto">;

export interface ResolvedSemanticReleaseOptions {
  branch: string;
  mode: ResolvedSemanticReleaseMode;
  packageManager: PackageManager;
  provider: GitProvider;
}

