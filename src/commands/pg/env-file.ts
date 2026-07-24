import { readFile, writeFile } from "node:fs/promises";

export type EnvUpdate = "created" | "added" | "replaced" | "unchanged";

async function currentContents(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function hasDatabaseUrl(filePath: string): Promise<boolean> {
  const contents = await currentContents(filePath);
  return contents !== undefined && /^DATABASE_URL=/mu.test(contents);
}

export async function writeDatabaseUrl(filePath: string, databaseUrl: string): Promise<EnvUpdate> {
  const contents = await currentContents(filePath);
  const line = `DATABASE_URL=${databaseUrl}`;

  if (contents === undefined) {
    await writeFile(filePath, `${line}\n`, { flag: "wx", mode: 0o600 });
    return "created";
  }

  if (/^DATABASE_URL=/mu.test(contents)) {
    const updated = contents.replace(/^DATABASE_URL=.*$/mu, line);
    if (updated === contents) {
      return "unchanged";
    }
    await writeFile(filePath, updated, { mode: 0o600 });
    return "replaced";
  }

  const separator = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
  await writeFile(filePath, `${contents}${separator}${line}\n`, { mode: 0o600 });
  return "added";
}
