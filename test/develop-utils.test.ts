import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runAddLicenses } from "../dist/commands/add-licenses/command.js";
import { runAddSemanticRelease } from "../dist/commands/add-semantic-release/command.js";
import { runCommand } from "../dist/shared/process.js";

async function tempRepo(prefix = "develop-utils-"): Promise<string> {
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

function runCli(args: string[], input = "", env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(process.execPath, ["dist/cli/develop-utils.js", ...args], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
    input,
  });
}

async function fakeNpmViewBin(packageName: string, result: "missing" | Record<string, unknown>): Promise<string> {
  const binDir = await mkdtemp(path.join(tmpdir(), "develop-utils-fake-npm-"));
  await mkdir(binDir, { recursive: true });
  const script = result === "missing"
    ? `#!/bin/sh
if [ "$1" = "view" ] && [ "$2" = "${packageName}" ]; then
  echo "npm ERR! code E404" >&2
  echo "npm ERR! 404 Not Found - GET https://registry.npmjs.org/${packageName}" >&2
  exit 1
fi
echo "unexpected npm command: $@" >&2
exit 1
`
    : `#!/bin/sh
if [ "$1" = "view" ] && [ "$2" = "${packageName}" ]; then
  printf '%s\\n' '${JSON.stringify(result).replaceAll("'", "'\\''")}'
  exit 0
fi
echo "unexpected npm command: $@" >&2
exit 1
`;
  const npmPath = path.join(binDir, "npm");
  await writeFile(npmPath, script);
  await chmod(npmPath, 0o755);
  return `${binDir}:${process.env.PATH || ""}`;
}

test("add-licenses derives owner and repository metadata from git config", async () => {
  const dir = await tempRepo("develop-utils-license-");

  runCli(["add-licenses", dir, "--project-name", "sample-project"], "y\ny\ny\n");

  const license = await readFile(path.join(dir, "LICENSE"), "utf8");
  const authorship = await readFile(path.join(dir, "AUTHORSHIP.md"), "utf8");

  assert.match(license, /Test Owner/);
  assert.match(license, /owner@example\.com/);
  assert.match(authorship, /\*\*sample-project\*\*/);
  assert.match(authorship, /GitHub: test-owner/);
  assert.match(authorship, /First commit.*January 02, 2024/s);
});

test("add-licenses requires approval before overwriting existing license files", async () => {
  const dir = await tempRepo("develop-utils-license-existing-");
  const existingLicense = path.join(dir, "LICENSE");
  await writeFile(existingLicense, "existing license text\n");

  const output = runCli(["add-licenses", dir], "n\nn\nn\nn\n");

  assert.match(output, /Overwrite existing .*LICENSE\? \[y\/n\]/);
  assert.match(output, /Skipped files:/);
  assert.equal(await readFile(existingLicense, "utf8"), "existing license text\n");
  await assert.rejects(
    readFile(path.join(dir, "COPYRIGHT.md"), "utf8"),
    /ENOENT/,
  );
});

test("interactive prompts color create green and overwrite red when color is enabled", async () => {
  const dir = await tempRepo("develop-utils-license-color-");
  await writeFile(path.join(dir, "LICENSE"), "existing license text\n");

  const output = runCli(["add-licenses", dir], "n\nn\nn\nn\n", { FORCE_COLOR: "1" });

  assert.match(output, /\u001B\[31mOverwrite existing\u001B\[0m .*LICENSE\? \[y\/n\]/);
  assert.match(output, /\u001B\[32mCreate\u001B\[0m .*COPYRIGHT\.md\? \[y\/n\]/);
});

test("add-licenses creates missing LICENSE but skips optional files when declined", async () => {
  const dir = await tempRepo("develop-utils-license-no-approval-");

  const output = runCli(["add-licenses", dir], "n\nn\nn\n");

  assert.match(output, /Create .*COPYRIGHT\.md\? \[y\/n\]/);
  assert.match(await readFile(path.join(dir, "LICENSE"), "utf8"), /Test Owner/);

  for (const fileName of ["COPYRIGHT.md", "AUTHORSHIP.md", ".gitattributes"]) {
    await assert.rejects(
      readFile(path.join(dir, fileName), "utf8"),
      /ENOENT/,
    );
  }
});

test("add-licenses can overwrite existing license files with explicit approval", async () => {
  const dir = await tempRepo("develop-utils-license-approved-");
  const existingLicense = path.join(dir, "LICENSE");
  await writeFile(existingLicense, "existing license text\n");

  runCli(["add-licenses", dir], "y\ny\ny\ny\n");

  assert.notEqual(await readFile(existingLicense, "utf8"), "existing license text\n");
  assert.match(await readFile(path.join(dir, "COPYRIGHT.md"), "utf8"), /Copyright Notice/);
  assert.match(await readFile(path.join(dir, "AUTHORSHIP.md"), "utf8"), /Authorship Declaration/);
});

test("interactive CLI exits after prompted add-licenses completes", async () => {
  const dir = await tempRepo("develop-utils-license-exits-");
  const result = spawnSync(process.execPath, [
    "dist/cli/develop-utils.js",
    "add-licenses",
    dir,
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    input: "y\ny\ny\n",
    timeout: 5_000,
  });

  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.match(result.stdout, /License files processed/);
});

test("add-semantic-release dry-run detects pnpm local-node mode and does not write files", async () => {
  const dir = await tempRepo("develop-utils-semrel-node-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "sample-project",
    version: "0.1.0",
    packageManager: "pnpm@9.15.0",
  }, null, 2));
  await writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

  const output = runCli(["add-semantic-release", dir, "--dry-run"], "n\n");

  await assert.rejects(
    readFile(path.join(dir, ".releaserc.json"), "utf8"),
    /ENOENT/,
  );
  assert.match(output, /DRY RUN command: pnpm add -D semantic-release/);
  assert.doesNotMatch(output, /DRY RUN command: .*@semantic-release\/npm/);
});

test("add-semantic-release auto mode uses ci-npx for non-Node repositories", async () => {
  const dir = await tempRepo("develop-utils-semrel-non-node-");

  runCli(["add-semantic-release", dir], "y\ny\n");

  const config = JSON.parse(await readFile(path.join(dir, ".releaserc.json"), "utf8")) as {
    plugins: Array<unknown>;
  };
  const workflow = await readFile(path.join(dir, ".github/workflows/release.yml"), "utf8");

  await assert.rejects(
    readFile(path.join(dir, "package.json"), "utf8"),
    /ENOENT/,
  );
  assert.deepEqual(config.plugins[2], [
    "@semantic-release/changelog",
    { changelogFile: "CHANGELOG.md" },
  ]);
  assert.deepEqual(config.plugins[3], [
    "@semantic-release/git",
    {
      assets: ["CHANGELOG.md"],
      message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
    },
  ]);
  assert.deepEqual(config.plugins[4], [
    "@semantic-release/github",
    {
      failCommentCondition: false,
    },
  ]);
  assert.match(workflow, /npx --package semantic-release@latest/);
  assert.doesNotMatch(workflow, /@semantic-release\/npm/);
  assert.doesNotMatch(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /Publish this package to npm/);
  assert.doesNotMatch(workflow, /npm ci|pnpm install|yarn install/);
});

test("add-semantic-release adds npm publishing when Node repo approves it", async () => {
  const dir = await tempRepo("develop-utils-semrel-npm-yes-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "sample-project",
    version: "0.1.0",
  }, null, 2));

  const pathWithFakeNpm = await fakeNpmViewBin("sample-project", "missing");
  const output = runCli(["add-semantic-release", dir, "--mode", "ci-npx"], "y\ny\ny\n", {
    PATH: pathWithFakeNpm,
  });

  const config = JSON.parse(await readFile(path.join(dir, ".releaserc.json"), "utf8")) as {
    plugins: Array<unknown>;
  };
  const workflow = await readFile(path.join(dir, ".github/workflows/release.yml"), "utf8");

  assert.match(output, /Publish this package to npm with @semantic-release\/npm\? \[y\/n\]/);
  assert.match(output, /npm publishing: enabled with @semantic-release\/npm/);
  assert.match(output, /npm package check: sample-project is not published yet/);
  assert.match(output, /npm auth: configure npm Trusted Publishing/);
  assert.deepEqual(config.plugins[3], "@semantic-release/npm");
  assert.deepEqual(config.plugins[4], [
    "@semantic-release/git",
    {
      assets: ["CHANGELOG.md", "package.json", "package-lock.json"],
      message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
    },
  ]);
  assert.deepEqual(config.plugins[5], [
    "@semantic-release/github",
    {
      failCommentCondition: false,
    },
  ]);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /registry-url: https:\/\/registry\.npmjs\.org/);
  assert.match(workflow, /--package @semantic-release\/npm@latest/);
  assert.match(workflow, /NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
});

test("add-semantic-release warns when npm package name already points to another repository", async () => {
  const dir = await tempRepo("develop-utils-semrel-npm-taken-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "taken-project",
    version: "0.1.0",
    repository: {
      type: "git",
      url: "git+https://github.com/test-owner/test-repo.git",
    },
  }, null, 2));
  const pathWithFakeNpm = await fakeNpmViewBin("taken-project", {
    name: "taken-project",
    version: "2.0.0",
    repository: {
      url: "git+https://github.com/someone-else/taken-project.git",
    },
  });

  const output = runCli(["add-semantic-release", dir, "--mode", "ci-npx", "--dry-run"], "y\n", {
    PATH: pathWithFakeNpm,
  });

  assert.match(output, /npm package check: npm view taken-project/);
  assert.match(output, /WARNING: npm package "taken-project" already exists \(2\.0\.0\)\./);
  assert.match(output, /WARNING: npm registry repository: git\+https:\/\/github\.com\/someone-else\/taken-project\.git/);
  assert.match(output, /WARNING: publish will fail unless your npm token or Trusted Publisher has publish access/);
});

test("add-semantic-release leaves npm publishing out when Node repo declines it", async () => {
  const dir = await tempRepo("develop-utils-semrel-npm-no-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "sample-project",
    version: "0.1.0",
  }, null, 2));

  const output = runCli(["add-semantic-release", dir, "--mode", "ci-npx"], "n\ny\ny\n");

  const config = JSON.parse(await readFile(path.join(dir, ".releaserc.json"), "utf8")) as {
    plugins: Array<unknown>;
  };
  const workflow = await readFile(path.join(dir, ".github/workflows/release.yml"), "utf8");

  assert.match(output, /Publish this package to npm with @semantic-release\/npm\? \[y\/n\]/);
  assert.notDeepEqual(config.plugins[3], "@semantic-release/npm");
  assert.doesNotMatch(workflow, /id-token: write/);
  assert.doesNotMatch(workflow, /@semantic-release\/npm/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
});

test("add-semantic-release local-node dry-run installs npm plugin only when approved", async () => {
  const dir = await tempRepo("develop-utils-semrel-local-node-npm-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "sample-project",
    version: "0.1.0",
  }, null, 2));

  const pathWithFakeNpm = await fakeNpmViewBin("sample-project", "missing");
  const output = runCli(["add-semantic-release", dir, "--mode", "local-node", "--dry-run"], "y\n", {
    PATH: pathWithFakeNpm,
  });

  assert.match(output, /DRY RUN command: npm install --save-dev .*@semantic-release\/npm/);
});

test("add-semantic-release does not write release files without approval", async () => {
  const dir = await tempRepo("develop-utils-semrel-no-approval-");

  const output = runCli(["add-semantic-release", dir], "n\nn\n");

  assert.match(output, /Create .*\.releaserc\.json\? \[y\/n\]/);

  await assert.rejects(
    readFile(path.join(dir, ".releaserc.json"), "utf8"),
    /ENOENT/,
  );
  await assert.rejects(
    readFile(path.join(dir, ".github/workflows/release.yml"), "utf8"),
    /ENOENT/,
  );
});

test("CLI help uses devu as the primary command", () => {
  const output = execFileSync(process.execPath, ["dist/cli/develop-utils.js", "--help"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });

  assert.match(output, /Usage: devu <command>/);
  assert.match(output, /develop-utils remains available as a long-form alias/);
  assert.doesNotMatch(output, /develope-utils/);
});

test("runCommand supports inherited stdio commands", () => {
  const output = runCommand(process.execPath, ["-e", ""], { stdio: "inherit" });

  assert.equal(output, "");
});
