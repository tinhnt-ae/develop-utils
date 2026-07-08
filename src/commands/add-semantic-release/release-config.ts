import type { GitProvider } from "../../shared/types.js";
import type { ResolvedSemanticReleaseMode } from "./types.js";

type SemanticReleasePlugin = string | [string, Record<string, unknown>];

export function semanticReleaseConfig(
  branch: string,
  provider: GitProvider,
  mode: ResolvedSemanticReleaseMode,
  publishToNpm = false,
): string {
  const assets = ["CHANGELOG.md"];

  if (mode === "local-node" || publishToNpm) {
    assets.push("package.json");
  }
  if (publishToNpm) {
    assets.push("package-lock.json");
  }

  const plugins: SemanticReleasePlugin[] = [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      { changelogFile: "CHANGELOG.md" },
    ],
  ];

  if (publishToNpm) {
    plugins.push("@semantic-release/npm");
  }

  plugins.push([
    "@semantic-release/git",
    {
      assets,
      message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
    },
  ]);

  if (provider === "github") {
    plugins.push([
      "@semantic-release/github",
      {
        failCommentCondition: false,
      },
    ]);
  } else if (provider === "gitlab") {
    plugins.push("@semantic-release/gitlab");
  }

  return `${JSON.stringify({ branches: [branch], plugins }, null, 2)}\n`;
}
