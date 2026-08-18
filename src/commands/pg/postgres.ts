import { runCommand } from "../../shared/process.js";

export interface PostgresTarget {
  adminUser: string;
  container: string;
  database: string;
  user: string;
}

export interface PostgresInspection {
  databaseExists: boolean;
  databaseOwner?: string;
  roleExists: boolean;
  roleState?: string;
}

export type ProvisioningOperation =
  | "create-role"
  | "alter-role-password"
  | "create-database"
  | "grant-database"
  | "grant-schema";

export interface PostgresProvisioningPlan {
  readonly operations: readonly ProvisioningOperation[];
  readonly target: Readonly<PostgresTarget>;
}

export interface ProvisionPostgresResult {
  databaseCreated: boolean;
  roleCreated: boolean;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPsql(target: PostgresTarget, database: string, sql: string, phase: "inspection" | "mutation" | "verification"): string {
  try {
    return runCommand("docker", [
      "exec",
      "-i",
      target.container,
      "psql",
      "--no-psqlrc",
      "--set",
      "ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      "--username",
      target.adminUser,
      "--dbname",
      database,
      "--file",
      "-",
    ], { input: `${sql}\n`, stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    throw new Error(`PostgreSQL ${phase} failed in container "${target.container}" for database "${database}". No command diagnostics are shown because they may contain credentials.`);
  }
}

export function inspectPostgres(target: PostgresTarget): PostgresInspection {
  const roleState = runPsql(
    target,
    "postgres",
    `SELECT rolcanlogin::int || '|' || rolsuper::int || '|' || rolcreatedb::int || '|' || rolcreaterole::int FROM pg_roles WHERE rolname = ${quoteLiteral(target.user)};`,
    "inspection",
  );
  const databaseOwner = runPsql(
    target,
    "postgres",
    `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = ${quoteLiteral(target.database)};`,
    "inspection",
  );

  return Object.freeze({
    databaseExists: databaseOwner !== "",
    databaseOwner: databaseOwner || undefined,
    roleExists: roleState !== "",
    roleState: roleState || undefined,
  });
}

export function buildPostgresProvisioningPlan(target: PostgresTarget, inspection: PostgresInspection): PostgresProvisioningPlan {
  if (inspection.roleExists && inspection.roleState !== "1|0|0|0") {
    throw new Error(`Existing role "${target.user}" is privileged or cannot log in; refusing to reuse it as an isolated project role.`);
  }

  if (inspection.databaseExists && inspection.databaseOwner !== target.user) {
    throw new Error(`Existing database "${target.database}" is owned by "${inspection.databaseOwner}", not "${target.user}"; refusing to change its ownership or grants.`);
  }

  const operations: ProvisioningOperation[] = [
    inspection.roleExists ? "alter-role-password" : "create-role",
    ...inspection.databaseExists ? [] : ["create-database" as const],
    "grant-database",
    "grant-schema",
  ];

  return Object.freeze({
    operations: Object.freeze(operations),
    target: Object.freeze({ ...target }),
  });
}

export function executePostgresProvisioning(plan: PostgresProvisioningPlan, password: string): ProvisionPostgresResult {
  for (const operation of plan.operations) {
    if (operation === "create-role") {
      runPsql(plan.target, "postgres", `CREATE ROLE ${quoteIdentifier(plan.target.user)} LOGIN PASSWORD ${quoteLiteral(password)};`, "mutation");
    } else if (operation === "alter-role-password") {
      runPsql(plan.target, "postgres", `ALTER ROLE ${quoteIdentifier(plan.target.user)} WITH LOGIN PASSWORD ${quoteLiteral(password)};`, "mutation");
    } else if (operation === "create-database") {
      runPsql(plan.target, "postgres", `CREATE DATABASE ${quoteIdentifier(plan.target.database)} OWNER ${quoteIdentifier(plan.target.user)};`, "mutation");
    } else if (operation === "grant-database") {
      runPsql(plan.target, "postgres", `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdentifier(plan.target.database)} TO ${quoteIdentifier(plan.target.user)};`, "mutation");
    } else {
      runPsql(plan.target, plan.target.database, `GRANT ALL ON SCHEMA public TO ${quoteIdentifier(plan.target.user)}; ALTER SCHEMA public OWNER TO ${quoteIdentifier(plan.target.user)};`, "mutation");
    }
  }

  return {
    databaseCreated: plan.operations.includes("create-database"),
    roleCreated: plan.operations.includes("create-role"),
  };
}

export function verifyPostgresProvisioning(target: PostgresTarget): void {
  const inspection = inspectPostgres(target);
  if (!inspection.roleExists || inspection.roleState !== "1|0|0|0") {
    throw new Error(`PostgreSQL verification failed: role "${target.user}" is missing or incompatible.`);
  }
  if (!inspection.databaseExists || inspection.databaseOwner !== target.user) {
    throw new Error(`PostgreSQL verification failed: database "${target.database}" is missing or has an unexpected owner.`);
  }
}
