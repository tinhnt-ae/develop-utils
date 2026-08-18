import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { SessionInfo, SessionProvider } from "./provider.js";

async function discoverClaudeSessions(home: string): Promise<SessionInfo[]> {
  const projectsDir = path.join(home, ".claude", "projects");
  let projectEntries;

  try {
    projectEntries = await readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectPath = path.join(projectsDir, projectEntry.name);
    let files;

    try {
      files = await readdir(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) {
        continue;
      }

      const filePath = path.join(projectPath, file.name);

      try {
        const info = await stat(filePath);
        sessions.push({
          agent: "claude-code",
          filePath,
          lastModified: info.mtime,
          projectDir: projectEntry.name,
          sessionId: path.basename(file.name, ".jsonl"),
          sizeBytes: info.size,
        });
      } catch {
        // File removed mid-walk; skip it.
      }
    }
  }

  return sessions;
}

export const claudeCodeProvider: SessionProvider = {
  discover: discoverClaudeSessions,
  id: "claude-code",
};
