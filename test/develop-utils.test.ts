import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { runAddLicenses } from "../dist/commands/add-licenses/command.js";
import { runAddSemanticRelease } from "../dist/commands/add-semantic-release/command.js";
import { assertReleaseWorkflowGate, bitbucketWorkflow, githubWorkflow, gitlabWorkflow } from "../dist/commands/add-semantic-release/workflows.js";
import { buildDatabaseName, buildUserName, normalizeProjectName } from "../dist/commands/pg/naming.js";
import { runPgInit } from "../dist/commands/pg/init.js";
import { runPortsKill } from "../dist/commands/ports/kill.js";
import { runPortsList } from "../dist/commands/ports/list.js";
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

async function fakeDockerBin(): Promise<{ logPath: string; path: string }> {
  const binDir = await mkdtemp(path.join(tmpdir(), "develop-utils-fake-docker-"));
  const logPath = path.join(binDir, "docker.log");
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "info" ]; then
  echo "26.1.0"
  exit 0
fi
if [ "$1" = "inspect" ]; then
  case "$3" in
    *State.Status*) echo "running" ;;
    *Config.Image*) echo "postgres:16" ;;
    *) echo "POSTGRES_USER=postgres" ;;
  esac
  exit 0
fi
if [ "$1" = "exec" ] && [ "$3" = "pg_isready" ]; then
  echo "accepting connections"
  exit 0
fi
if [ "$1" = "exec" ] && [ "$2" = "-i" ] && [ "$4" = "psql" ]; then
  sql=$(cat)
  printf 'SQL %s\\n' "$sql" >> "$FAKE_DOCKER_LOG"
  if [ "$FAKE_DOCKER_FAIL_INSPECTION" = "1" ] && printf '%s' "$sql" | grep -q "FROM pg_database"; then
    echo "inspection failed" >&2
    exit 1
  fi
  if [ "$FAKE_DOCKER_FAIL_MUTATION" = "1" ] && printf '%s' "$sql" | grep -q "CREATE ROLE"; then
    printf 'failed SQL: %s\\n' "$sql" >&2
    exit 1
  fi
  case "$sql" in
    *"FROM pg_roles"*)
      if { [ "$FAKE_DOCKER_EXISTING" = "1" ] && [ "$FAKE_DOCKER_ROLE_EXISTS" != "0" ]; } || [ -f "$FAKE_DOCKER_LOG.role" ]; then echo "\${FAKE_DOCKER_ROLE_STATE:-1|0|0|0}"; fi
      ;;
    *"FROM pg_database"*)
      if [ -f "$FAKE_DOCKER_LOG.database" ]; then cat "$FAKE_DOCKER_LOG.database"; elif [ "$FAKE_DOCKER_EXISTING" = "1" ]; then echo "$FAKE_DOCKER_DB_OWNER"; fi
      ;;
    *"CREATE ROLE"*|*"ALTER ROLE"*) touch "$FAKE_DOCKER_LOG.role" ;;
    *"CREATE DATABASE"*)
      printf '%s\\n' "$sql" | sed -n 's/.* OWNER "\\([^"]*\\)".*/\\1/p' > "$FAKE_DOCKER_LOG.database"
      ;;
  esac
  exit 0
fi
echo "unexpected docker command: $*" >&2
exit 1
`;
  const dockerPath = path.join(binDir, "docker");
  await writeFile(dockerPath, script);
  await chmod(dockerPath, 0o755);
  return { logPath, path: `${binDir}:${process.env.PATH || ""}` };
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
  assert.match(output, /npm run build/);
  assert.match(output, /npm test/);
  assert.match(output, /npm run pack:dry-run/);
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
  assert.match(workflow, /validation:/);
  assert.match(workflow, /needs: validation/);
  assert.match(workflow, /npm ci/);
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
  assert.doesNotMatch(workflow, /registry-url/);
  assert.match(workflow, /--package @semantic-release\/npm@latest/);
  assert.doesNotMatch(workflow, /NPM_TOKEN/);
  assert.match(workflow, /needs: validation/);
});

test("release workflow gate rejects unsafe GitHub variants", () => {
  const workflow = githubWorkflow("main", "github", "local-node", "npm", true);
  assert.doesNotThrow(() => assertReleaseWorkflowGate(workflow, "github"));

  const unsafeVariants = [
    workflow.replace("  validation:\n", "  checks:\n"),
    workflow.replace("      - run: npm run build\n", ""),
    workflow.replace("      - run: npm test\n", ""),
    workflow.replace("      - run: npm run pack:dry-run\n", ""),
    workflow.replace("    needs: validation\n", ""),
    workflow.replace("      - run: npm test\n", "      - run: npm test\n      - run: npx semantic-release\n"),
    workflow.replace("    needs: validation\n", "    needs: validation\n    if: always()\n"),
  ];

  for (const unsafe of unsafeVariants) {
    assert.throws(() => assertReleaseWorkflowGate(unsafe, "github"));
  }
});

test("committed GitHub workflow matches the canonical gated generator", async () => {
  const committed = await readFile(path.resolve(import.meta.dirname, "../.github/workflows/release.yml"), "utf8");
  const generated = githubWorkflow("main", "github", "local-node", "npm", true);
  assert.equal(committed, generated);
  assert.doesNotThrow(() => assertReleaseWorkflowGate(committed, "github"));
});

test("generated GitLab and Bitbucket release pipelines validate before release", () => {
  const gitlab = gitlabWorkflow("main", "gitlab", "local-node", "npm", false);
  const bitbucket = bitbucketWorkflow("main", "bitbucket", "local-node", "npm", false);

  assert.doesNotThrow(() => assertReleaseWorkflowGate(gitlab, "gitlab"));
  assert.doesNotThrow(() => assertReleaseWorkflowGate(bitbucket, "bitbucket"));
  assert.match(gitlab, /stages:\n  - validate\n  - release/);
  assert.match(bitbucket, /name: Validate[\s\S]*npm run pack:dry-run[\s\S]*name: Release[\s\S]*semantic-release/);
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
  assert.match(output, /WARNING: publish will fail unless npm Trusted Publishing or your npm token has access/);
});

test("add-semantic-release warns locally when package name is unscoped repo name", async () => {
  const dir = await tempRepo("develop-utils-semrel-unscoped-local-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "test-repo",
    version: "0.1.0",
  }, null, 2));
  const pathWithFakeNpm = await fakeNpmViewBin("test-repo", "missing");

  const output = runCli(["add-semantic-release", dir, "--mode", "ci-npx", "--dry-run"], "y\n", {
    PATH: pathWithFakeNpm,
  });

  assert.match(output, /local package check: "test-repo" is unscoped; npm will publish the global package name\./);
  assert.match(output, /local package check: use "@test-owner\/test-repo" if this should publish under the GitHub\/npm org scope\./);
  assert.match(output, /npm package check: test-repo is not published yet\./);
});

test("add-semantic-release warns locally when scoped package differs from repository", async () => {
  const dir = await tempRepo("develop-utils-semrel-scoped-local-");
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "@other-scope/other-name",
    version: "0.1.0",
  }, null, 2));
  const pathWithFakeNpm = await fakeNpmViewBin("@other-scope/other-name", "missing");

  const output = runCli(["add-semantic-release", dir, "--mode", "ci-npx", "--dry-run"], "y\n", {
    PATH: pathWithFakeNpm,
  });

  assert.match(output, /local package check: package name "@other-scope\/other-name" differs from repository slug "test-owner\/test-repo"\./);
  assert.match(output, /local package check: keep it only if the npm scope\/name is intentional\./);
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
  assert.match(output, /pg\s+Local PostgreSQL setup helpers/);
  assert.match(output, /develop-utils remains available as a long-form alias/);
  assert.doesNotMatch(output, /develope-utils/);
});

test("pg help shows available commands", () => {
  const output = runCli(["pg", "--help"]);

  assert.match(output, /Usage: devu pg <command>/);
  assert.match(output, /init\s+Preview local PostgreSQL database provisioning/);
});

test("pg init dry-run prints planned PostgreSQL provisioning actions", async () => {
  const dir = await tempRepo("develop-utils-pg-init-");
  const envPath = path.join(dir, ".env.local");
  const fakeDocker = await fakeDockerBin();

  const output = runCli(["pg", "init", dir, "--dry-run", "--project", "Story Audio", "--container", "local-postgres"], "", {
    PATH: fakeDocker.path,
    FAKE_DOCKER_LOG: fakeDocker.logPath,
  });

  assert.match(output, /Project directory:/);
  assert.match(output, /Project name: story_audio/);
  assert.match(output, /Database name: story_audio_dev/);
  assert.match(output, /Database user: story_audio_user/);
  assert.match(output, /Container: local-postgres/);
  assert.match(output, /Docker:/);
  assert.match(output, /Inspect/);
  assert.match(output, /validate/);
  assert.match(output, /PostgreSQL-compatible container/);
  assert.match(output, /PostgreSQL:/);
  assert.match(output, /Provision database "story_audio_dev"/);
  assert.match(output, /Grant "story_audio_user" ownership\/privileges/);
  assert.match(output, /Files:/);
  assert.match(output, /DATABASE_URL=postgresql:\/\/story_audio_user:\*\*\*\*\*\*@local-postgres:5432\/story_audio_dev/);
  assert.match(output, /No Docker commands, SQL statements, or files were changed/);

  await assert.rejects(
    readFile(envPath, "utf8"),
    /ENOENT/,
  );
  await assert.rejects(readFile(fakeDocker.logPath, "utf8"), /ENOENT/);
});

test("pg init can be cancelled before Docker or PostgreSQL changes", async () => {
  const dir = await tempRepo("develop-utils-pg-init-required-");
  const fakeDocker = await fakeDockerBin();
  const result = spawnSync(process.execPath, [
    "dist/cli/develop-utils.js",
    "pg",
    "init",
    dir,
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fakeDocker.path,
      FAKE_DOCKER_LOG: fakeDocker.logPath,
    },
    input: "n\n",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /PostgreSQL provisioning cancelled; nothing was changed/);
  const dockerLog = await readFile(fakeDocker.logPath, "utf8");
  assert.match(dockerLog, /FROM pg_roles/);
  assert.match(dockerLog, /FROM pg_database/);
  assert.doesNotMatch(dockerLog, /CREATE ROLE|ALTER ROLE|CREATE DATABASE|ALTER DATABASE|GRANT|REVOKE|ALTER SCHEMA|CREATE SCHEMA/);
});

test("pg init dry-run does not inspect Docker, generate a password, or write files", async () => {
  const dir = await tempRepo("develop-utils-pg-dry-run-isolation-");
  const fakeDocker = await fakeDockerBin();
  const originalPath = process.env.PATH;
  const originalFakeDockerLog = process.env.FAKE_DOCKER_LOG;
  process.env.PATH = fakeDocker.path;
  process.env.FAKE_DOCKER_LOG = fakeDocker.logPath;
  try {
    await runPgInit([dir, "--container", "audit-postgres", "--dry-run"], {
      generatePassword: () => {
        throw new Error("password generation must not run during dry-run");
      },
    });
  } finally {
    process.env.PATH = originalPath;
    if (originalFakeDockerLog === undefined) delete process.env.FAKE_DOCKER_LOG;
    else process.env.FAKE_DOCKER_LOG = originalFakeDockerLog;
  }

  await assert.rejects(readFile(fakeDocker.logPath, "utf8"), /ENOENT/);
  await assert.rejects(readFile(path.join(dir, ".env.local"), "utf8"), /ENOENT/);
});

test("pg init provisions an isolated database in an existing container and writes DATABASE_URL", async () => {
  const dir = await tempRepo("develop-utils-pg-provision-");
  const fakeDocker = await fakeDockerBin();

  const output = runCli([
    "pg", "init", dir,
    "--container", "shared-postgres",
    "--project", "Story Audio",
    "--password", "ProvidedSecret-DoNotPrint-123",
    "--yes",
  ], "", {
    PATH: fakeDocker.path,
    FAKE_DOCKER_LOG: fakeDocker.logPath,
  });

  const env = await readFile(path.join(dir, ".env.local"), "utf8");
  const envMode = (await stat(path.join(dir, ".env.local"))).mode & 0o777;
  const dockerLog = await readFile(fakeDocker.logPath, "utf8");
  assert.match(output, /Role: created/);
  assert.match(output, /Database: created/);
  assert.equal(env, "DATABASE_URL=postgresql://story_audio_user:ProvidedSecret-DoNotPrint-123@shared-postgres:5432/story_audio_dev\n");
  assert.equal(envMode, 0o600);
  assert.doesNotMatch(output, /ProvidedSecret-DoNotPrint-123/);
  assert.match(output, /postgresql:\/\/story_audio_user:\*\*\*@shared-postgres:5432\/story_audio_dev/);
  assert.match(dockerLog, /inspect --format .*State.Status.* shared-postgres/);
  assert.match(dockerLog, /CREATE ROLE "story_audio_user" LOGIN PASSWORD 'ProvidedSecret-DoNotPrint-123'/);
  assert.match(dockerLog, /CREATE DATABASE "story_audio_dev" OWNER "story_audio_user"/);
  assert.doesNotMatch(dockerLog, /docker run| run -d /);
});

test("pg init rerun reuses existing role and database without CREATE statements", async () => {
  const dir = await tempRepo("develop-utils-pg-existing-");
  const fakeDocker = await fakeDockerBin();

  const output = runCli([
    "pg", "init", dir,
    "--container", "shared-postgres",
    "--project", "existing-app",
    "--password", "known-secret",
    "--yes",
  ], "", {
    PATH: fakeDocker.path,
    FAKE_DOCKER_LOG: fakeDocker.logPath,
    FAKE_DOCKER_EXISTING: "1",
    FAKE_DOCKER_DB_OWNER: "existing_app_user",
  });

  const dockerLog = await readFile(fakeDocker.logPath, "utf8");
  assert.match(output, /Role: already existed/);
  assert.match(output, /Database: already existed/);
  assert.match(dockerLog, /ALTER ROLE/);
  assert.doesNotMatch(dockerLog, /CREATE ROLE|CREATE DATABASE/);
});

test("pg init does not rotate an automatic password while preserving an existing DATABASE_URL", async () => {
  const dir = await tempRepo("develop-utils-pg-env-safe-");
  const fakeDocker = await fakeDockerBin();
  const envPath = path.join(dir, ".env.local");
  await writeFile(envPath, "OTHER=value\nDATABASE_URL=postgresql://old\n");

  const result = spawnSync(process.execPath, [
    "dist/cli/develop-utils.js", "pg", "init", dir, "--container", "shared-postgres", "--yes",
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fakeDocker.path,
      FAKE_DOCKER_LOG: fakeDocker.logPath,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Use --yes --force to rotate the generated password/);
  assert.equal(await readFile(envPath, "utf8"), "OTHER=value\nDATABASE_URL=postgresql://old\n");
  await assert.rejects(readFile(fakeDocker.logPath, "utf8"), /ENOENT/);
});

test("pg init refuses to take over a database owned by another role", async () => {
  const dir = await tempRepo("develop-utils-pg-owner-");
  const fakeDocker = await fakeDockerBin();
  const result = spawnSync(process.execPath, [
    "dist/cli/develop-utils.js", "pg", "init", dir,
    "--container", "shared-postgres", "--project", "isolated-app",
    "--password", "known-secret", "--yes",
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fakeDocker.path,
      FAKE_DOCKER_LOG: fakeDocker.logPath,
      FAKE_DOCKER_EXISTING: "1",
      FAKE_DOCKER_DB_OWNER: "another_user",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /owned by "another_user".*refusing to change its ownership or grants/);
  const dockerLog = await readFile(fakeDocker.logPath, "utf8");
  assert.doesNotMatch(dockerLog, /CREATE ROLE|ALTER ROLE|CREATE DATABASE|ALTER DATABASE|GRANT|REVOKE|ALTER SCHEMA|CREATE SCHEMA/);
});

test("pg init does not create a missing role when an existing database has another owner", async () => {
  const dir = await tempRepo("develop-utils-pg-owner-missing-role-");
  const fakeDocker = await fakeDockerBin();
  const result = spawnSync(process.execPath, [
    "dist/cli/develop-utils.js", "pg", "init", dir,
    "--container", "shared-postgres", "--project", "isolated-app",
    "--password", "ProvidedSecret-DoNotPrint-123", "--yes",
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fakeDocker.path,
      FAKE_DOCKER_LOG: fakeDocker.logPath,
      FAKE_DOCKER_EXISTING: "1",
      FAKE_DOCKER_ROLE_EXISTS: "0",
      FAKE_DOCKER_DB_OWNER: "another_user",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /owned by "another_user"/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ProvidedSecret-DoNotPrint-123/);
  const dockerLog = await readFile(fakeDocker.logPath, "utf8");
  assert.doesNotMatch(dockerLog, /CREATE ROLE|ALTER ROLE|CREATE DATABASE|ALTER DATABASE|GRANT|REVOKE|ALTER SCHEMA|CREATE SCHEMA/);
});

test("pg init performs zero mutation when database inspection fails", async () => {
  const dir = await tempRepo("develop-utils-pg-inspection-failure-");
  const fakeDocker = await fakeDockerBin();
  const result = spawnSync(process.execPath, [
    "dist/cli/develop-utils.js", "pg", "init", dir,
    "--container", "shared-postgres", "--password", "ProvidedSecret-DoNotPrint-123", "--yes",
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fakeDocker.path,
      FAKE_DOCKER_LOG: fakeDocker.logPath,
      FAKE_DOCKER_FAIL_INSPECTION: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /PostgreSQL inspection failed/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ProvidedSecret-DoNotPrint-123/);
  const dockerLog = await readFile(fakeDocker.logPath, "utf8");
  assert.doesNotMatch(dockerLog, /CREATE ROLE|ALTER ROLE|CREATE DATABASE|ALTER DATABASE|GRANT|REVOKE|ALTER SCHEMA|CREATE SCHEMA/);
});

test("pg init suppresses credential-bearing child diagnostics on mutation failure", async () => {
  const dir = await tempRepo("develop-utils-pg-mutation-failure-");
  const fakeDocker = await fakeDockerBin();
  const result = spawnSync(process.execPath, [
    "dist/cli/develop-utils.js", "pg", "init", dir,
    "--container", "shared-postgres", "--password", "ProvidedSecret-DoNotPrint-123", "--yes",
  ], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fakeDocker.path,
      FAKE_DOCKER_LOG: fakeDocker.logPath,
      FAKE_DOCKER_FAIL_MUTATION: "1",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /PostgreSQL mutation failed/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /ProvidedSecret-DoNotPrint-123/);
});

test("pg init redacts an internally generated password from output", async () => {
  const dir = await tempRepo("develop-utils-pg-generated-secret-");
  const fakeDocker = await fakeDockerBin();
  const stdout: string[] = [];
  const originalLog = console.log;
  const originalPath = process.env.PATH;
  const originalFakeDockerLog = process.env.FAKE_DOCKER_LOG;
  process.env.PATH = fakeDocker.path;
  process.env.FAKE_DOCKER_LOG = fakeDocker.logPath;
  console.log = (...values: unknown[]) => stdout.push(values.join(" "));
  try {
    await runPgInit([
      dir, "--container", "shared-postgres", "--project", "generated-app", "--yes",
    ], {
      generatePassword: () => "GeneratedSecret-DoNotPrint-456",
    });
  } finally {
    console.log = originalLog;
    process.env.PATH = originalPath;
    if (originalFakeDockerLog === undefined) {
      delete process.env.FAKE_DOCKER_LOG;
    } else {
      process.env.FAKE_DOCKER_LOG = originalFakeDockerLog;
    }
  }

  const output = stdout.join("\n");
  const env = await readFile(path.join(dir, ".env.local"), "utf8");
  assert.equal(env, "DATABASE_URL=postgresql://generated_app_user:GeneratedSecret-DoNotPrint-456@shared-postgres:5432/generated_app_dev\n");
  assert.doesNotMatch(output, /GeneratedSecret-DoNotPrint-456/);
  assert.match(output, /postgresql:\/\/generated_app_user:\*\*\*@shared-postgres:5432\/generated_app_dev/);
});

test("PostgreSQL naming utilities build safe default identifiers", () => {
  assert.equal(normalizeProjectName("ledgerbase"), "ledgerbase");
  assert.equal(buildDatabaseName("ledgerbase"), "ledgerbase_dev");
  assert.equal(buildUserName("ledgerbase"), "ledgerbase_user");
  assert.equal(normalizeProjectName("Story Audio"), "story_audio");
  assert.equal(buildDatabaseName("Story Audio"), "story_audio_dev");
  assert.equal(buildUserName("Story Audio"), "story_audio_user");
  assert.equal(normalizeProjectName("My---API!!!"), "my_api");
  assert.equal(normalizeProjectName("123 --- !!!"), "project");

  const longName = "Very Long Project Name ".repeat(5);
  assert.equal(buildDatabaseName(longName).endsWith("_dev"), true);
  assert.equal(buildUserName(longName).endsWith("_user"), true);
  assert.ok(buildDatabaseName(longName).length <= 63);
  assert.ok(buildUserName(longName).length <= 63);
});

test("runCommand supports inherited stdio commands", () => {
  const output = runCommand(process.execPath, ["-e", ""], { stdio: "inherit" });

  assert.equal(output, "");
});

async function branchRepo(prefix = "develop-utils-branches-"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test Owner"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "owner@example.com"], { cwd: dir });
  await writeFile(path.join(dir, "README.md"), "# Test\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z",
    },
    stdio: "ignore",
  });
  return dir;
}

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function commitDated(dir: string, message: string, isoDate: string): void {
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", message], {
    cwd: dir,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_DATE: isoDate,
    },
    stdio: "ignore",
  });
}

test("git-branches list flags merged old branches as stale and leaves recent work alone", async () => {
  const dir = await branchRepo();
  git(dir, ["checkout", "-q", "-b", "old-merged"]);
  commitDated(dir, "merged change", "2020-01-02T00:00:00Z");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "old-merged", "-m", "merge old-merged"]);
  git(dir, ["checkout", "-q", "-b", "recent-work"]);
  commitDated(dir, "recent work", new Date().toISOString());
  git(dir, ["checkout", "-q", "main"]);

  const output = runCli(["git-branches", "list", dir]);

  assert.match(output, /old-merged\t.*STALE/);
  assert.doesNotMatch(output, /recent-work\t.*STALE/);
  assert.match(output, /main\t.*\(current, default, merged\)/);
});

test("git-branches clean --dry-run prints the plan without deleting branches", async () => {
  const dir = await branchRepo();
  git(dir, ["checkout", "-q", "-b", "old-merged"]);
  commitDated(dir, "merged change", "2020-01-02T00:00:00Z");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "old-merged", "-m", "merge old-merged"]);

  const output = runCli(["git-branches", "clean", dir, "--dry-run"]);

  assert.match(output, /DRY RUN git branch cleanup plan:/);
  assert.match(output, /Delete "old-merged"/);
  assert.match(output, /No branches were deleted\./);
  assert.match(git(dir, ["branch", "--list", "old-merged"]), /old-merged/);
});

test("git-branches clean deletes merged stale branches with --yes", async () => {
  const dir = await branchRepo();
  git(dir, ["checkout", "-q", "-b", "old-merged"]);
  commitDated(dir, "merged change", "2020-01-02T00:00:00Z");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "old-merged", "-m", "merge old-merged"]);

  const output = runCli(["git-branches", "clean", dir, "--yes"]);

  assert.match(output, /Deleted: old-merged/);
  assert.equal(git(dir, ["branch", "--list", "old-merged"]), "");
});

test("git-branches clean skips a stale unmerged branch without --force and deletes it with --force", async () => {
  const dir = await branchRepo();
  const bare = await mkdtemp(path.join(tmpdir(), "develop-utils-branches-bare-"));
  execFileSync("git", ["init", "-q", "--bare"], { cwd: bare });
  git(dir, ["remote", "add", "origin", bare]);
  git(dir, ["push", "-q", "origin", "main"]);
  git(dir, ["checkout", "-q", "-b", "feature-gone"]);
  commitDated(dir, "feature work", "2020-01-03T00:00:00Z");
  git(dir, ["push", "-q", "-u", "origin", "feature-gone"]);
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["push", "-q", "origin", "--delete", "feature-gone"]);
  git(dir, ["fetch", "-q", "--prune", "origin"]);

  const skippedOutput = runCli(["git-branches", "clean", dir, "--yes"]);

  assert.match(skippedOutput, /Skipped \(not fully merged; rerun with --force to delete\): feature-gone/);
  assert.match(git(dir, ["branch", "--list", "feature-gone"]), /feature-gone/);

  const forcedOutput = runCli(["git-branches", "clean", dir, "--yes", "--force"]);

  assert.match(forcedOutput, /Deleted: feature-gone/);
  assert.equal(git(dir, ["branch", "--list", "feature-gone"]), "");
});

test("git-branches clean protects the current branch, default branch, and --protect names", async () => {
  const dir = await branchRepo();
  git(dir, ["checkout", "-q", "-b", "old-merged"]);
  commitDated(dir, "merged change", "2020-01-02T00:00:00Z");
  git(dir, ["checkout", "-q", "main"]);
  git(dir, ["merge", "-q", "--no-ff", "old-merged", "-m", "merge old-merged"]);

  const output = runCli(["git-branches", "clean", dir, "--yes", "--protect", "old-merged"]);

  assert.match(output, /No stale local branches found\./);
  assert.match(git(dir, ["branch", "--list", "old-merged"]), /old-merged/);
});

test("git-branches sync fetches and prunes deleted remote-tracking branches", async () => {
  const dir = await branchRepo();
  const bare = await mkdtemp(path.join(tmpdir(), "develop-utils-branches-bare-"));
  execFileSync("git", ["init", "-q", "--bare"], { cwd: bare });
  git(dir, ["remote", "add", "origin", bare]);
  git(dir, ["push", "-q", "origin", "main"]);
  git(dir, ["checkout", "-q", "-b", "feature-gone"]);
  commitDated(dir, "feature work", "2020-01-03T00:00:00Z");
  git(dir, ["push", "-q", "-u", "origin", "feature-gone"]);
  git(dir, ["checkout", "-q", "main"]);

  // Delete the branch directly in the bare remote (instead of `git push
  // --delete` from `dir`) so dir's local remote-tracking ref is not
  // auto-pruned as a side effect of the delete push itself.
  execFileSync("git", ["branch", "-D", "feature-gone"], { cwd: bare });

  assert.match(git(dir, ["branch", "-r"]), /origin\/feature-gone/);

  const output = runCli(["git-branches", "sync", dir]);

  assert.match(output, /Sync complete\./);
  assert.doesNotMatch(git(dir, ["branch", "-r"]), /origin\/feature-gone/);
});

test("git-branches sync --dry-run does not fetch", async () => {
  const dir = await branchRepo();

  const output = runCli(["git-branches", "sync", dir, "--dry-run"]);

  assert.match(output, /DRY RUN: git fetch --prune origin/);
});

test("git-branches list rejects a directory that is not a git repository", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "develop-utils-branches-nongit-"));

  assert.throws(() => runCli(["git-branches", "list", dir]), /is not a git repository/);
});

async function captureLog(run: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    await run();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

test("ports list prints discovered processes via injected lookup", async () => {
  const output = await captureLog(() => runPortsList(["--port", "4000"], {
    findProcesses: (port) => {
      assert.equal(port, 4000);
      return [{ command: "node", pid: 4242 }];
    },
  }));

  assert.match(output, /Port 4000:/);
  assert.match(output, /pid 4242 \(node\)/);
});

test("ports list reports when no process is found", async () => {
  const output = await captureLog(() => runPortsList(["--port", "4000"], {
    findProcesses: () => [],
  }));

  assert.match(output, /No process is listening on port 4000\./);
});

test("ports kill --dry-run prints the plan without signaling processes", async () => {
  let killed = false;
  const output = await captureLog(() => runPortsKill(["--port", "4000", "--dry-run"], {
    findProcesses: () => [{ command: "node", pid: 4242 }],
    killProcess: () => {
      killed = true;
    },
  }));

  assert.match(output, /DRY RUN: would send SIGTERM/);
  assert.equal(killed, false);
});

test("ports kill --yes signals matching processes and escalates to SIGKILL with --force", async () => {
  const signals: string[] = [];
  const output = await captureLog(() => runPortsKill(["--port", "4000", "--yes", "--force"], {
    findProcesses: () => [{ command: "node", pid: 4242 }],
    killProcess: (_pid, signal) => {
      signals.push(signal);
    },
  }));

  assert.deepEqual(signals, ["SIGKILL"]);
  assert.match(output, /Signaled 1 of 1 process\(es\) with SIGKILL\./);
});

test("ports kill never signals pid 1 or the CLI's own process", async () => {
  const signaledPids: number[] = [];
  const output = await captureLog(() => runPortsKill(["--port", "4000", "--yes"], {
    findProcesses: () => [
      { command: "launchd", pid: 1 },
      { command: "node", pid: process.pid },
      { command: "node", pid: 4242 },
    ],
    killProcess: (pid) => {
      signaledPids.push(pid);
    },
  }));

  assert.deepEqual(signaledPids, [4242]);
  assert.match(output, /pid 1 \(launchd\) \(protected, will not be signaled\)/);
  assert.match(output, new RegExp(`pid ${process.pid} \\(node\\) \\(protected, will not be signaled\\)`));
});

test("ports kill reports per-process failures without throwing", async () => {
  const output = await captureLog(() => runPortsKill(["--port", "4000", "--yes"], {
    findProcesses: () => [{ command: "node", pid: 4242 }],
    killProcess: () => {
      throw new Error("no such process");
    },
  }));

  assert.match(output, /Signaled 0 of 1 process\(es\) with SIGTERM\./);
  assert.match(output, /Failed: 4242 \(no such process\)/);
});

test("ports kill requires --port", async () => {
  await assert.rejects(runPortsKill([]), /--port is required/);
});

function hasLsof(): boolean {
  if (process.platform === "win32") {
    return false;
  }
  try {
    execFileSync("which", ["lsof"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("failed to allocate a port")));
      }
    });
  });
}

async function waitForPortListener(port: number, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const output = runCli(["ports", "list", "--port", String(port)]);
    if (!output.includes("No process is listening")) {
      return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for a listener on port ${port}`);
}

test("ports list and kill find and stop a real listening process", { skip: !hasLsof() }, async () => {
  const port = await findFreePort();
  const child = spawn(process.execPath, [
    "-e",
    `require("node:http").createServer((_req, res) => res.end("ok")).listen(${port})`,
  ], { stdio: "ignore" });

  try {
    await waitForPortListener(port);

    const listOutput = runCli(["ports", "list", "--port", String(port)]);
    assert.match(listOutput, new RegExp(`pid ${child.pid} \\(node\\)`));

    const declineOutput = runCli(["ports", "kill", "--port", String(port)], "n\n");
    assert.match(declineOutput, /Port kill cancelled; nothing was changed\./);

    const killOutput = runCli(["ports", "kill", "--port", String(port)], "y\n");
    assert.match(killOutput, /Signaled 1 of 1 process\(es\) with SIGTERM\./);

    await sleep(300);
    const finalOutput = runCli(["ports", "list", "--port", String(port)]);
    assert.match(finalOutput, /No process is listening/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
});
