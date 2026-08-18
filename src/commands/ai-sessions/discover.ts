import { claudeCodeProvider } from "./claude-provider.js";
import type { SessionInfo, SessionProvider } from "./provider.js";

export const DEFAULT_PROVIDERS: SessionProvider[] = [claudeCodeProvider];

export async function discoverSessions(
  providers: SessionProvider[],
  home: string,
  project?: string,
): Promise<SessionInfo[]> {
  const results = await Promise.all(providers.map((provider) => provider.discover(home)));
  const sessions = results.flat();

  return project ? sessions.filter((session) => session.projectDir === project) : sessions;
}
