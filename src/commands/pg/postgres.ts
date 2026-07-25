import { runCommand } from "../../shared/process.js";

export interface ProvisionPostgresOptions {
  adminUser: string;
  container: string;
  database: string;
  password: string;
  user: string;
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

function runPsql(options: ProvisionPostgresOptions, database: string, sql: string): string {
  return runCommand("docker", [
    "exec",
    options.container,
    "psql",
    "--no-psqlrc",
    "--set",
    "ON_ERROR_STOP=1",
    "--tuples-only",
    "--no-align",
    "--username",
    options.adminUser,
    "--dbname",
    database,
    "--file",
    "-",
  ], { input: `${sql}\n` });
}

export function provisionPostgres(options: ProvisionPostgresOptions): ProvisionPostgresResult {
  const roleState = runPsql(
    options,
    "postgres",
    `SELECT rolcanlogin::int || '|' || rolsuper::int || '|' || rolcreatedb::int || '|' || rolcreaterole::int FROM pg_roles WHERE rolname = ${quoteLiteral(options.user)};`,
  );
  const roleExists = roleState !== "";

  if (roleExists && roleState !== "1|0|0|0") {
    throw new Error(`Existing role "${options.user}" is privileged or cannot log in; refusing to reuse it as an isolated project role.`);
  }

  if (!roleExists) {
    runPsql(
      options,
      "postgres",
      `CREATE ROLE ${quoteIdentifier(options.user)} LOGIN PASSWORD ${quoteLiteral(options.password)};`,
    );
  } else {
    runPsql(
      options,
      "postgres",
      `ALTER ROLE ${quoteIdentifier(options.user)} WITH LOGIN PASSWORD ${quoteLiteral(options.password)};`,
    );
  }

  const databaseOwner = runPsql(
    options,
    "postgres",
    `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = ${quoteLiteral(options.database)};`,
  );
  const databaseExists = databaseOwner !== "";

  if (databaseExists && databaseOwner !== options.user) {
    throw new Error(`Existing database "${options.database}" is owned by "${databaseOwner}", not "${options.user}"; refusing to change its ownership or grants.`);
  }

  if (!databaseExists) {
    runPsql(
      options,
      "postgres",
      `CREATE DATABASE ${quoteIdentifier(options.database)} OWNER ${quoteIdentifier(options.user)};`,
    );
  }

  runPsql(
    options,
    "postgres",
    `GRANT ALL PRIVILEGES ON DATABASE ${quoteIdentifier(options.database)} TO ${quoteIdentifier(options.user)};`,
  );
  runPsql(
    options,
    options.database,
    `GRANT ALL ON SCHEMA public TO ${quoteIdentifier(options.user)}; ALTER SCHEMA public OWNER TO ${quoteIdentifier(options.user)};`,
  );

  return {
    databaseCreated: !databaseExists,
    roleCreated: !roleExists,
  };
}
