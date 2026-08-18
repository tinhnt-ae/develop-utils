export interface SessionInfo {
  agent: string;
  filePath: string;
  lastModified: Date;
  projectDir: string;
  sessionId: string;
  sizeBytes: number;
}

export interface SessionProvider {
  discover(home: string): Promise<SessionInfo[]>;
  id: string;
}
