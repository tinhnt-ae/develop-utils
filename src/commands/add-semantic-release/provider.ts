import type { GitProvider } from "../../shared/types.js";

export function npxReleaseCommand(provider: GitProvider, publishToNpm = false): string {
  const packages = [
    "semantic-release@latest",
    "@semantic-release/changelog@latest",
    "@semantic-release/git@latest",
  ];

  if (publishToNpm) {
    packages.push("@semantic-release/npm@latest");
  }

  if (provider === "github") {
    packages.push("@semantic-release/github@latest");
  } else if (provider === "gitlab") {
    packages.push("@semantic-release/gitlab@latest");
  }

  return `npx ${packages.map((pkg) => `--package ${pkg}`).join(" ")} semantic-release`;
}
