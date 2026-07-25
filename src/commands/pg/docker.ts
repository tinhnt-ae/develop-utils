import { runCommand } from "../../shared/process.js";

export interface PostgresContainer {
  adminUser: string;
  name: string;
}

function dockerError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function inspectPostgresContainer(name: string, requestedAdminUser?: string): PostgresContainer {
  try {
    runCommand("docker", ["info", "--format", "{{.ServerVersion}}"]);
  } catch (error) {
    throw new Error(`Docker is not installed or its daemon is unavailable: ${dockerError(error)}`);
  }

  let state: string;
  let image: string;
  let environment: string;
  try {
    state = runCommand("docker", ["inspect", "--format", "{{.State.Status}}", name]);
    image = runCommand("docker", ["inspect", "--format", "{{.Config.Image}}", name]);
    environment = runCommand("docker", ["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", name]);
  } catch (error) {
    throw new Error(`PostgreSQL container "${name}" was not found: ${dockerError(error)}`);
  }

  if (state !== "running") {
    throw new Error(`PostgreSQL container "${name}" is not running (status: ${state || "unknown"}).`);
  }

  if (!/(postgres|postgresql|postgis|timescale)/iu.test(image)) {
    throw new Error(`Container "${name}" does not use a recognized PostgreSQL-compatible image (${image}).`);
  }

  const configuredAdmin = environment
    .split(/\r?\n/u)
    .find((entry) => entry.startsWith("POSTGRES_USER="))
    ?.slice("POSTGRES_USER=".length);
  const adminUser = requestedAdminUser || configuredAdmin || "postgres";

  try {
    runCommand("docker", ["exec", name, "pg_isready", "-U", adminUser]);
  } catch (error) {
    throw new Error(`PostgreSQL in container "${name}" is not ready for admin user "${adminUser}": ${dockerError(error)}`);
  }

  return { adminUser, name };
}
