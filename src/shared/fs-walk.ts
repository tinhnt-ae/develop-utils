import { readdir } from "node:fs/promises";
import path from "node:path";

export interface WalkDirectoriesOptions {
  skip?: string[];
  shouldRecurse?: (dirPath: string, name: string) => boolean;
}

export async function* walkDirectories(
  root: string,
  options: WalkDirectoriesOptions = {},
): AsyncGenerator<string> {
  const skip = new Set(options.skip ?? []);

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || skip.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(root, entry.name);
    yield fullPath;

    if (!options.shouldRecurse || options.shouldRecurse(fullPath, entry.name)) {
      yield* walkDirectories(fullPath, options);
    }
  }
}
