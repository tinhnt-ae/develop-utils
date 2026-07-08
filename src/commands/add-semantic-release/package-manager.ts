import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PackageManager } from "../../shared/types.js";

export function detectPackageManager(projectDir: string): PackageManager {
  const packageJsonPath = path.join(projectDir, "package.json");

  if (existsSync(packageJsonPath)) {
    try {
      const packageManager = execFileSync(process.execPath, [
        "-e",
        "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write((pkg.packageManager||'').split('@')[0]);",
        packageJsonPath,
      ], { encoding: "utf8" });

      if (packageManager === "pnpm" || packageManager === "npm" || packageManager === "yarn") {
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

export function installCommand(packageManager: PackageManager, deps: string[]): [string, string[]] {
  if (packageManager === "pnpm") {
    return ["pnpm", ["add", "-D", ...deps]];
  }
  if (packageManager === "yarn") {
    return ["yarn", ["add", "-D", ...deps]];
  }
  return ["npm", ["install", "--save-dev", ...deps]];
}

export function ciInstallCommand(packageManager: PackageManager): string {
  if (packageManager === "pnpm") {
    return "pnpm install --frozen-lockfile";
  }
  if (packageManager === "yarn") {
    return "yarn install --immutable";
  }
  return "npm ci";
}

export function ciReleaseCommand(packageManager: PackageManager): string {
  if (packageManager === "pnpm") {
    return "pnpm exec semantic-release";
  }
  if (packageManager === "yarn") {
    return "yarn semantic-release";
  }
  return "npx semantic-release";
}

