import * as path from "node:path";
import * as vscode from "vscode";
import { SessionBridgeService } from "../application/sessionBridgeService";
import type {
  SessionFilterState,
  SessionRecord,
  SessionTimeFilter
} from "../shared/types";

class InfoTreeItem extends vscode.TreeItem {
  public constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = "info";
  }
}

export class SessionTreeItem extends vscode.TreeItem {
  public readonly session: SessionRecord;

  public constructor(session: SessionRecord) {
    super(session.title ?? session.id, vscode.TreeItemCollapsibleState.None);
    this.session = session;
    this.id = session.id;
    this.contextValue = "session";
    this.description = formatDescription(session);
    this.tooltip = new vscode.MarkdownString(
      [
        `**Session ID**: \`${session.id}\``,
        `**Working Directory**: ${session.cwd ?? "Unknown"}`,
        `**Source File**: \`${session.sourcePath}\``,
        `**Provider**: ${session.modelProvider ?? "Unknown"}`,
        `**Updated At**: ${session.updatedAt ?? "Unknown"}`
      ].join("\n\n")
    );
    this.command = {
      command: "codexSessionBridge.restoreSession",
      title: "Restore to Codex",
      arguments: [session]
    };
  }
}

export class SessionsViewProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<vscode.TreeItem | undefined | void>();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private sessions: SessionRecord[] = [];
  private isLoading = false;
  private lastError: string | null = null;
  private searchQuery = "";
  private filters: SessionFilterState = {
    provider: null,
    cwd: null,
    archived: "all",
    timeWindow: "all"
  };

  public constructor(private readonly service: SessionBridgeService) {}

  public async refresh(): Promise<void> {
    this.isLoading = true;
    this.lastError = null;
    this.onDidChangeTreeDataEmitter.fire();

    try {
      this.sessions = await this.service.refreshSessions();
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "Unknown refresh failure";
      this.sessions = [];
    } finally {
      this.isLoading = false;
      this.onDidChangeTreeDataEmitter.fire();
    }
  }

  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): vscode.TreeItem[] {
    const visibleSessions = this.getVisibleSessions();

    if (this.isLoading) {
      return [new InfoTreeItem("Loading local Codex sessions...")];
    }

    if (this.lastError) {
      return [new InfoTreeItem("Failed to load sessions", this.lastError)];
    }

    if (!this.sessions.length) {
      return [new InfoTreeItem("No sessions found", "Refresh after .codex scan")];
    }

    if (!visibleSessions.length) {
      return [
        new InfoTreeItem(
          "No sessions match the current search or filters",
          buildEmptyStateDescription(this.searchQuery, this.getFilterSummary())
        )
      ];
    }

    return visibleSessions.map((session) => new SessionTreeItem(session));
  }

  public getFirstSession(): SessionRecord | undefined {
    return this.getVisibleSessions()[0];
  }

  public setSearchQuery(query: string): void {
    this.searchQuery = query.trim();
    this.onDidChangeTreeDataEmitter.fire();
  }

  public clearSearchQuery(): void {
    this.searchQuery = "";
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getSearchQuery(): string {
    return this.searchQuery;
  }

  public getFilterState(): SessionFilterState {
    return { ...this.filters };
  }

  public updateFilters(nextFilters: Partial<SessionFilterState>): void {
    this.filters = {
      ...this.filters,
      ...nextFilters
    };
    this.onDidChangeTreeDataEmitter.fire();
  }

  public clearFilters(): void {
    this.filters = {
      provider: null,
      cwd: null,
      archived: "all",
      timeWindow: "all"
    };
    this.onDidChangeTreeDataEmitter.fire();
  }

  public getFilterOptions(): {
    providers: string[];
    cwdValues: string[];
  } {
    return {
      providers: uniqueValues(this.sessions.map((session) => session.modelProvider)),
      cwdValues: uniqueValues(this.sessions.map((session) => session.cwd))
    };
  }

  public getFilterSummary(): string {
    const parts = [
      this.filters.provider ? `provider=${this.filters.provider}` : null,
      this.filters.cwd ? `cwd=${this.filters.cwd}` : null,
      this.filters.archived !== "all" ? `archived=${this.filters.archived}` : null,
      this.filters.timeWindow !== "all" ? `time=${this.filters.timeWindow}` : null
    ].filter((value): value is string => Boolean(value));

    return parts.join(", ");
  }

  private getVisibleSessions(): SessionRecord[] {
    return this.sessions.filter(
      (session) => matchesSearch(session, this.searchQuery) && matchesFilters(session, this.filters)
    );
  }
}

function buildEmptyStateDescription(
  searchQuery: string,
  filterSummary: string
): string | undefined {
  const parts = [
    searchQuery ? `query=${searchQuery}` : null,
    filterSummary || null
  ].filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function formatDescription(session: SessionRecord): string {
  const cwdBase = session.cwd ? path.basename(session.cwd) : "unknown";
  const updatedAt = session.updatedAt
    ? new Date(session.updatedAt).toLocaleString()
    : "unknown";
  return `${cwdBase} | ${updatedAt}`;
}

function matchesSearch(session: SessionRecord, searchQuery: string): boolean {
  if (!searchQuery) {
    return true;
  }

  const needle = searchQuery.toLowerCase();
  return [session.id, session.title, session.cwd, session.modelProvider, session.sourcePath]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(needle));
}

function matchesFilters(
  session: SessionRecord,
  filters: SessionFilterState
): boolean {
  if (filters.provider && session.modelProvider !== filters.provider) {
    return false;
  }

  if (filters.cwd && session.cwd !== filters.cwd) {
    return false;
  }

  if (filters.archived === "active" && session.isArchived) {
    return false;
  }

  if (filters.archived === "archived" && !session.isArchived) {
    return false;
  }

  if (!matchesTimeWindow(session.updatedAt, filters.timeWindow)) {
    return false;
  }

  return true;
}

function matchesTimeWindow(
  updatedAt: string | null,
  timeWindow: SessionTimeFilter
): boolean {
  if (timeWindow === "all") {
    return true;
  }

  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }

  const windowDays = {
    "7d": 7,
    "30d": 30,
    "90d": 90
  }[timeWindow];

  return updatedAtMs >= Date.now() - windowDays * 24 * 60 * 60 * 1000;
}

function uniqueValues(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))]
    .sort((left, right) => left.localeCompare(right));
}
