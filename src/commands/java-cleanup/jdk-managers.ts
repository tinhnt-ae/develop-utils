import { readdir, readFile, readlink, stat } from "node:fs/promises";
import path from "node:path";

export interface JdkManager {
  candidatesRoot(home: string): string;
  getActiveVersion(home: string): Promise<string | undefined>;
  id: "sdkman" | "jenv" | "jabba";
  listInstalledVersions(home: string): Promise<string[]>;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function listSubdirectories(root: string, exclude: string[] = []): Promise<string[]> {
  let entries;

  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && !exclude.includes(entry.name))
    .map((entry) => entry.name);
}

async function readTrimmedFile(filePath: string): Promise<string | undefined> {
  try {
    const trimmed = (await readFile(filePath, "utf8")).trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

function sdkmanCandidatesRoot(home: string): string {
  return path.join(home, ".sdkman", "candidates", "java");
}

const sdkmanManager: JdkManager = {
  id: "sdkman",
  candidatesRoot: sdkmanCandidatesRoot,
  listInstalledVersions: (home) => listSubdirectories(sdkmanCandidatesRoot(home), ["current"]),
  getActiveVersion: async (home) => {
    try {
      const target = await readlink(path.join(sdkmanCandidatesRoot(home), "current"));
      return path.basename(target);
    } catch {
      return undefined;
    }
  },
};

function jenvCandidatesRoot(home: string): string {
  return path.join(home, ".jenv", "versions");
}

const jenvManager: JdkManager = {
  id: "jenv",
  candidatesRoot: jenvCandidatesRoot,
  listInstalledVersions: (home) => listSubdirectories(jenvCandidatesRoot(home)),
  getActiveVersion: (home) => readTrimmedFile(path.join(home, ".jenv", "version")),
};

function jabbaCandidatesRoot(home: string): string {
  return path.join(home, ".jabba", "jdk");
}

const jabbaManager: JdkManager = {
  id: "jabba",
  candidatesRoot: jabbaCandidatesRoot,
  listInstalledVersions: (home) => listSubdirectories(jabbaCandidatesRoot(home)),
  getActiveVersion: (home) => readTrimmedFile(path.join(home, ".jabba", "version")),
};

export const JDK_MANAGERS: Record<string, JdkManager> = {
  jabba: jabbaManager,
  jenv: jenvManager,
  sdkman: sdkmanManager,
};

export async function detectManager(home: string, requested?: string): Promise<JdkManager> {
  if (requested) {
    const manager = JDK_MANAGERS[requested];
    if (!manager) {
      throw new Error(`Unknown --manager "${requested}"; supported managers: ${Object.keys(JDK_MANAGERS).join(", ")}`);
    }
    return manager;
  }

  const detected: JdkManager[] = [];
  for (const manager of Object.values(JDK_MANAGERS)) {
    if (await pathExists(manager.candidatesRoot(home))) {
      detected.push(manager);
    }
  }

  if (detected.length === 0) {
    throw new Error(`No supported Java version manager found (${Object.keys(JDK_MANAGERS).join(", ")}). Pass --manager to select one explicitly.`);
  }

  if (detected.length > 1) {
    throw new Error(`Multiple Java version managers found (${detected.map((manager) => manager.id).join(", ")}); pass --manager to select one.`);
  }

  return detected[0];
}
