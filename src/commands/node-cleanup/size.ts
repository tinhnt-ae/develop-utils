import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function directorySizeBytes(root: string): Promise<number> {
  let entries;

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }

  let total = 0;

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      total += await directorySizeBytes(fullPath);
      continue;
    }

    if (entry.isFile()) {
      try {
        total += (await stat(fullPath)).size;
      } catch {
        // File removed mid-walk; skip it.
      }
    }
  }

  return total;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${UNITS[unitIndex]}`;
}
