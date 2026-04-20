import type { SessionRecord } from "../shared/types";
import { SessionScanner } from "../discovery/sessionScanner";

export class SessionIndex {
  private sessions: SessionRecord[] = [];

  public constructor(private readonly scanner: SessionScanner) {}

  public async refresh(): Promise<SessionRecord[]> {
    this.sessions = await this.scanner.scanSessions();
    return this.sessions;
  }

  public getAll(): SessionRecord[] {
    return [...this.sessions];
  }

  public getById(id: string): SessionRecord | undefined {
    return this.sessions.find((session) => session.id === id);
  }
}
