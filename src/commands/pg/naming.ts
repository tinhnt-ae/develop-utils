const postgresIdentifierLimit = 63;

function limitIdentifier(value: string, suffix = ""): string {
  const maxBaseLength = postgresIdentifierLimit - suffix.length;
  const base = value.slice(0, Math.max(1, maxBaseLength)).replace(/_+$/u, "");
  return `${base || "project"}${suffix}`;
}

export function normalizeProjectName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .replace(/_+/gu, "_");

  const withValidStart = normalized.replace(/^[^a-z]+/u, "");
  return limitIdentifier(withValidStart || "project");
}

export function buildDatabaseName(projectName: string): string {
  return limitIdentifier(normalizeProjectName(projectName), "_dev");
}

export function buildUserName(projectName: string): string {
  return limitIdentifier(normalizeProjectName(projectName), "_user");
}
