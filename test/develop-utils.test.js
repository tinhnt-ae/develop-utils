import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAddLicenses } from "../lib/add-licenses.js";
import { runAddSemanticRelease } from "../lib/add-semantic-release.js";

async function tempRepo(prefix = "develop-utils-") {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test Owner"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "owner@example.com"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:test-owner/test-repo.git"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "# Test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2024-01-02T00:00:00Z",
      GIT_COMMITTER_DATE: "2024-01-02T00:00:00Z",
    },
    stdio: "ignore",
  });
  return dir;
}

test("add-licenses derives owner and repository metadata from git config", async () => {
  const dir = await tempRepo("develop-utils-license-");

  await runAddLicenses([dir, "--project-name", "sample-project"]);

  const license = await readFile(path.join(dir, "LICENSE"), "utf8");
  const authorship = await readFile(path.join(dir, "AUTHORSHIP.md"), "utf8");

  assert.match(license, /Test Owner/);
  assert.match(license, /owner@example\.com/);
  assert.match(authorship, /\*\*sample-project\*\*/);
  assert.match(authorship, /GitHub: test-owner/);
  assert.match(authorship, /First commit.*January 02, 2024/s);
});

test("add-semantic-release dry-run detects pnpm local-node mode and does not write files", async () => {
  const dir = await tempRepo("develop-utils-semrel-node-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "sample-project",
    version: "0.1.0",
    packageManager: "pnpm@9.15.0",
  }, null, 2));
  await writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  await runAddSemanticRelease([dir, "--dry-run"]);

  await assert.rejects(
    readFile(path.join(dir, ".releaserc.json"), "utf8"),
    /ENOENT/,
  );
});

test("add-semantic-release auto mode uses ci-npx for non-Node repositories", async () => {
  const dir = await tempRepo("develop-utils-semrel-non-node-");

  await runAddSemanticRelease([dir]);

  const config = JSON.parse(await readFile(path.join(dir, ".releaserc.json"), "utf8"));
  const workflow = await readFile(path.join(dir, ".github/workflows/release.yml"), "utf8");

  await assert.rejects(
    readFile(path.join(dir, "package.json"), "utf8"),
    /ENOENT/,
  );
  assert.deepEqual(config.plugins[2], [
    "@semantic-release/changelog",
    { changelogFile: "CHANGELOG.md" },
  ]);
  assert.deepEqual(config.plugins[3][1].assets, ["CHANGELOG.md"]);
  assert.match(workflow, /npx --package semantic-release@latest/);
  assert.doesNotMatch(workflow, /npm ci|pnpm install|yarn install/);
});

test("CLI help uses develop-utils spelling", () => {
  const output = execFileSync(process.execPath, ["bin/develop-utils.js", "--help"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });

  assert.match(output, /Usage: develop-utils <command>/);
  assert.doesNotMatch(output, /develope-utils/);
});
