import path from "node:path";
import { randomBytes } from "node:crypto";
import { inspectPostgresContainer } from "./docker.js";
import { buildDatabaseName, buildUserName, normalizeProjectName } from "./naming.js";
import { printPlannedActions, type PlannedAction } from "./dry-run.js";
import { hasDatabaseUrl, writeDatabaseUrl } from "./env-file.js";
import { provisionPostgres } from "./postgres.js";
import { confirmAction } from "../../shared/prompts.js";

interface PgInitOptions {
  container: string;
  database?: string;
  dryRun: boolean;
  envFile: string;
  force: boolean;
  help: boolean;
  host?: string;
  adminUser?: string;
  password: string;
  projectDir: string;
  projectName?: string;
  user?: string;
  yes: boolean;
}

export function initHelp(): string {
  return `Usage: devu pg init [project-dir] [--project name] [--database name] [--user name] [--password auto|value] [--container name] [--admin-user name] [--host name] [--env path] [--dry-run] [--yes] [--force]

Creates an isolated database and role in an existing PostgreSQL container.
The command never creates, starts, stops, or removes a container.

Options:
  --project name     Project name used for default database and role names.
  --database name    Database name. Defaults to <project>_dev.
  --user name        Database role. Defaults to <project>_user.
  --password value   Password value, or "auto" to generate one. Defaults to auto.
  --container name   Existing PostgreSQL container. Defaults to develop-utils-postgres.
  --admin-user name  PostgreSQL admin role. Defaults to the container POSTGRES_USER.
  --host name        Host written to DATABASE_URL. Defaults to the container name.
  --env path         Env file target. Defaults to .env.local.
  --dry-run          Print the plan without changing Docker, PostgreSQL, or files.
  --yes              Provision and write a missing DATABASE_URL without prompting.
  --force            With --yes, replace an existing DATABASE_URL.`;
}

function parsePgInitArgs(argv: string[]): PgInitOptions {
  const options: PgInitOptions = {
    container: "develop-utils-postgres",
    dryRun: false,
    envFile: ".env.local",
    force: false,
    help: false,
    password: "auto",
    projectDir: process.cwd(),
    yes: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--project") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--project requires a value");
      }
      options.projectName = argv[i];
    } else if (arg.startsWith("--project=")) {
      options.projectName = arg.slice("--project=".length);
    } else if (arg === "--database") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--database requires a value");
      }
      options.database = argv[i];
    } else if (arg.startsWith("--database=")) {
      options.database = arg.slice("--database=".length);
    } else if (arg === "--user") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--user requires a value");
      }
      options.user = argv[i];
    } else if (arg.startsWith("--user=")) {
      options.user = arg.slice("--user=".length);
    } else if (arg === "--password") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--password requires a value");
      }
      options.password = argv[i];
    } else if (arg.startsWith("--password=")) {
      options.password = arg.slice("--password=".length);
    } else if (arg === "--container") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--container requires a value");
      }
      options.container = argv[i];
    } else if (arg.startsWith("--container=")) {
      options.container = arg.slice("--container=".length);
    } else if (arg === "--admin-user") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--admin-user requires a value");
      }
      options.adminUser = argv[i];
    } else if (arg.startsWith("--admin-user=")) {
      options.adminUser = arg.slice("--admin-user=".length);
    } else if (arg === "--host") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--host requires a value");
      }
      options.host = argv[i];
    } else if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
    } else if (arg === "--env") {
      i += 1;
      if (!argv[i]) {
        throw new Error("--env requires a value");
      }
      options.envFile = argv[i];
    } else if (arg.startsWith("--env=")) {
      options.envFile = arg.slice("--env=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unsupported option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error("Only one project-dir argument is supported");
  }

  if (positional[0]) {
    options.projectDir = positional[0];
  }

  options.projectDir = path.resolve(options.projectDir);
  return options;
}

function validateIdentifier(value: string, option: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value) || value.length > 63) {
    throw new Error(`${option} must be a lowercase PostgreSQL identifier of at most 63 characters`);
  }
  return value;
}

function buildDatabaseUrl(user: string, password: string, host: string, database: string): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/${encodeURIComponent(database)}`;
}

export async function runPgInit(argv = process.argv.slice(2)): Promise<void> {
  const options = parsePgInitArgs(argv);

  if (options.help) {
    console.log(initHelp());
    return;
  }

  const rawProjectName = options.projectName || path.basename(options.projectDir);
  const projectName = normalizeProjectName(rawProjectName);
  const databaseName = validateIdentifier(options.database || buildDatabaseName(projectName), "--database");
  const userName = validateIdentifier(options.user || buildUserName(projectName), "--user");
  const envPath = path.resolve(options.projectDir, options.envFile);
  const host = options.host || options.container;
  const passwordLabel = options.password === "auto" ? "generate a project password" : "use the provided project password";
  const previewUrl = buildDatabaseUrl(userName, "******", host, databaseName);
  const actions: PlannedAction[] = [
    {
      group: "Docker",
      description: `Inspect and validate existing PostgreSQL-compatible container "${options.container}".`,
    },
    {
      group: "Docker",
      description: `Require existing running container "${options.container}"; never create or mutate container lifecycle.`,
    },
    {
      group: "PostgreSQL",
      description: `Provision database "${databaseName}" for project "${projectName}".`,
    },
    {
      group: "PostgreSQL",
      description: `Provision role "${userName}" and ${passwordLabel}.`,
    },
    {
      group: "PostgreSQL",
      description: `Grant "${userName}" ownership/privileges for "${databaseName}" and public schema access.`,
    },
    {
      group: "Files",
      description: `Write DATABASE_URL=${previewUrl} to ${envPath} only after confirmation.`,
    },
  ];

  console.log(`Project directory: ${options.projectDir}`);
  console.log(`Project name: ${projectName}`);
  console.log(`Database name: ${databaseName}`);
  console.log(`Database user: ${userName}`);
  console.log(`Env file: ${envPath}`);
  console.log(`Container: ${options.container}`);
  console.log(`Connection host: ${host}`);

  if (options.dryRun) {
    printPlannedActions(actions);
    return;
  }

  if (!options.yes && !await confirmAction(`Provision database "${databaseName}" and role "${userName}" in container "${options.container}"?`)) {
    console.log("PostgreSQL provisioning cancelled; nothing was changed.");
    return;
  }

  const existingDatabaseUrl = await hasDatabaseUrl(envPath);
  let shouldWrite = false;
  if (options.yes) {
    shouldWrite = !existingDatabaseUrl || options.force;
    if (existingDatabaseUrl && !options.force && options.password === "auto") {
      throw new Error(`DATABASE_URL already exists in ${envPath}. Use --yes --force to rotate the generated password, or provide --password to leave the file unchanged.`);
    }
  } else {
    const action = existingDatabaseUrl ? "Overwrite existing DATABASE_URL in" : "Write DATABASE_URL to";
    shouldWrite = await confirmAction(`${action} ${envPath}?`);
    if (!shouldWrite && options.password === "auto") {
      console.log("PostgreSQL provisioning cancelled because an auto-generated password must be written to the environment file.");
      return;
    }
  }

  const container = inspectPostgresContainer(options.container, options.adminUser);
  const password = options.password === "auto" ? randomBytes(24).toString("base64url") : options.password;
  const result = provisionPostgres({
    adminUser: container.adminUser,
    container: container.name,
    database: databaseName,
    password,
    user: userName,
  });
  const databaseUrl = buildDatabaseUrl(userName, password, host, databaseName);

  console.log(`Role: ${result.roleCreated ? "created" : "already existed"}`);
  console.log(`Database: ${result.databaseCreated ? "created" : "already existed"}`);
  console.log(`DATABASE_URL=${databaseUrl}`);

  if (shouldWrite) {
    const update = await writeDatabaseUrl(envPath, databaseUrl);
    console.log(`Environment file ${update}: ${envPath}`);
  } else {
    console.log(`Environment file unchanged: ${envPath}`);
  }
}
