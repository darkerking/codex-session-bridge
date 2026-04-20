import * as path from "node:path";
import * as vscode from "vscode";
import { SessionBridgeService } from "../application/sessionBridgeService";
import type {
  SessionFilterState,
  SessionRecord,
  SessionTimeFilter
} from "../shared/types";

type SessionGroupKey = "today" | "last7d" | "last30d" | "older";

interface SessionGroup {
  key: SessionGroupKey;
  label: string;
  sessions: SessionRecord[];
}

type SessionViewMessage =
  | { type: "restore"; sessionId: string }
  | { type: "preview"; sessionId: string }
  | { type: "search"; query: string };

export class SessionsViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
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

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: SessionBridgeService
  ) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true
    };

    view.webview.onDidReceiveMessage((message: SessionViewMessage) => {
      void this.handleMessage(message);
    });

    this.render();
  }

  public async refresh(): Promise<void> {
    this.isLoading = true;
    this.lastError = null;
    this.render();

    try {
      this.sessions = await this.service.refreshSessions();
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "Unknown refresh failure";
      this.sessions = [];
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  public getFirstSession(): SessionRecord | undefined {
    return this.getVisibleSessions()[0];
  }

  public getSessionById(id: string): SessionRecord | undefined {
    return this.sessions.find((session) => session.id === id);
  }

  public setSearchQuery(query: string): void {
    this.searchQuery = query.trim();
    this.render();
  }

  public clearSearchQuery(): void {
    this.searchQuery = "";
    this.render();
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
    this.render();
  }

  public clearFilters(): void {
    this.filters = {
      provider: null,
      cwd: null,
      archived: "all",
      timeWindow: "all"
    };
    this.render();
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

  private getGroupedSessions(): SessionGroup[] {
    const grouped = new Map<SessionGroupKey, SessionRecord[]>();

    for (const session of this.getVisibleSessions()) {
      const key = getGroupKey(session.updatedAt);
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.push(session);
      } else {
        grouped.set(key, [session]);
      }
    }

    const orderedGroups: SessionGroup[] = [
      { key: "today", label: "TODAY", sessions: grouped.get("today") ?? [] },
      { key: "last7d", label: "LAST WEEK", sessions: grouped.get("last7d") ?? [] },
      { key: "last30d", label: "LAST 30 DAYS", sessions: grouped.get("last30d") ?? [] },
      { key: "older", label: "OLDER", sessions: grouped.get("older") ?? [] }
    ];

    return orderedGroups.filter((group) => group.sessions.length > 0);
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = this.getHtml(this.view.webview);
  }

  private async handleMessage(message: SessionViewMessage): Promise<void> {
    switch (message.type) {
      case "search":
        this.setSearchQuery(message.query);
        return;
      case "restore": {
        const session = this.getSessionById(message.sessionId);
        if (session) {
          await vscode.commands.executeCommand(
            "codexSessionBridge.restoreSession",
            session
          );
        }
        return;
      }
      case "preview": {
        const session = this.getSessionById(message.sessionId);
        if (session) {
          await vscode.commands.executeCommand(
            "codexSessionBridge.previewSession",
            session
          );
        }
        return;
      }
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = createNonce();
    const groups = this.getGroupedSessions();
    const filterSummary = this.getFilterSummary();
    const body = this.isLoading
      ? `<div class="state-card"><div class="state-title">Loading sessions...</div><div class="state-copy">Scanning local Codex data.</div></div>`
      : this.lastError
        ? `<div class="state-card state-error"><div class="state-title">Failed to load sessions</div><div class="state-copy">${escapeHtml(this.lastError)}</div></div>`
        : groups.length === 0
          ? `<div class="state-card"><div class="state-title">No sessions match</div><div class="state-copy">${escapeHtml(buildEmptyStateDescription(this.searchQuery, filterSummary) ?? "Try clearing search or filters.")}</div></div>`
          : groups.map((group) => renderGroup(group)).join("");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Session Bridge</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: var(--vscode-sideBar-background);
        --surface: color-mix(in srgb, var(--vscode-sideBar-background) 84%, white 16%);
        --surface-hover: color-mix(in srgb, var(--vscode-sideBar-background) 74%, white 26%);
        --border: color-mix(in srgb, var(--vscode-sideBar-border, #2c2c32) 80%, white 20%);
        --muted: var(--vscode-descriptionForeground);
        --text: var(--vscode-foreground);
        --accent: #4093ff;
        --status: #aeb6c2;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: var(--vscode-font-family);
      }

      .panel {
        padding: 14px 12px 18px;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }

      .eyebrow {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: color-mix(in srgb, var(--text) 78%, transparent 22%);
      }

      .pill {
        max-width: 58%;
        padding: 4px 8px;
        border: 1px solid var(--border);
        border-radius: 999px;
        color: var(--muted);
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .search-shell {
        margin-bottom: 14px;
      }

      .search {
        width: 100%;
        border: 1px solid transparent;
        border-radius: 10px;
        background: var(--surface);
        color: var(--text);
        padding: 10px 12px;
        font-size: 12px;
        outline: none;
      }

      .search:focus {
        border-color: var(--accent);
      }

      .search::placeholder {
        color: var(--muted);
      }

      .group {
        margin-top: 16px;
      }

      .group-label {
        margin-bottom: 8px;
        color: color-mix(in srgb, var(--text) 72%, transparent 28%);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
      }

      .session-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .session {
        position: relative;
        width: 100%;
        border: 1px solid transparent;
        background: transparent;
        color: inherit;
        text-align: left;
        padding: 6px 8px;
        border-radius: 10px;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease;
      }

      .session:hover,
      .session:focus {
        background: var(--surface-hover);
        border-color: var(--border);
        outline: none;
      }

      .session-main {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 8px;
        align-items: start;
      }

      .dot {
        width: 7px;
        height: 7px;
        margin-top: 5px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent 82%);
      }

      .session-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        line-height: 1.25;
      }

      .session-meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 1px;
        padding-left: 15px;
        padding-right: 74px;
        color: var(--muted);
        font-size: 11px;
        line-height: 1.2;
      }

      .session-status {
        color: var(--status);
      }

      .session-aside {
        color: color-mix(in srgb, var(--text) 84%, transparent 16%);
        font-size: 11px;
        white-space: nowrap;
        padding-top: 1px;
      }

      .session-actions {
        display: flex;
        gap: 6px;
        position: absolute;
        right: 8px;
        top: 28px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 120ms ease;
      }

      .session:hover .session-actions,
      .session:focus .session-actions {
        opacity: 1;
        pointer-events: auto;
      }

      .action {
        border: 1px solid var(--border);
        border-radius: 999px;
        background: color-mix(in srgb, var(--surface) 88%, white 12%);
        color: var(--muted);
        padding: 2px 7px;
        font-size: 10px;
        line-height: 1.4;
        cursor: pointer;
      }

      .action:hover {
        color: var(--text);
        border-color: color-mix(in srgb, var(--accent) 55%, var(--border) 45%);
      }

      .state-card {
        margin-top: 14px;
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 16px;
        background: var(--surface);
      }

      .state-error {
        border-color: color-mix(in srgb, var(--vscode-errorForeground, #f14c4c) 45%, var(--border) 55%);
      }

      .state-title {
        font-size: 13px;
        font-weight: 700;
      }

      .state-copy {
        margin-top: 6px;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
    </style>
  </head>
  <body>
    <div class="panel">
      <div class="topbar">
        <div class="eyebrow">SESSIONS</div>
        <div class="pill">${escapeHtml(filterSummary || "All sessions")}</div>
      </div>
      <div class="search-shell">
        <input class="search" id="search" type="text" value="${escapeHtml(this.searchQuery)}" placeholder="Search sessions" />
      </div>
      ${body}
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const search = document.getElementById("search");
      let timer;

      search?.addEventListener("input", (event) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          vscode.postMessage({
            type: "search",
            query: event.target.value
          });
        }, 120);
      });

      document.querySelectorAll("[data-action]").forEach((element) => {
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          const target = event.currentTarget;
          vscode.postMessage({
            type: target.dataset.action,
            sessionId: target.dataset.sessionId
          });
        });
      });

      document.querySelectorAll("[data-restore]").forEach((element) => {
        element.addEventListener("click", () => {
          vscode.postMessage({
            type: "restore",
            sessionId: element.dataset.restore
          });
        });

        element.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            vscode.postMessage({
              type: "restore",
              sessionId: element.dataset.restore
            });
          }
        });
      });
    </script>
  </body>
</html>`;
  }
}

function renderGroup(group: SessionGroup): string {
  return `<section class="group">
    <div class="group-label">${group.label}</div>
    <div class="session-list">
      ${group.sessions.map((session) => renderSession(session)).join("")}
    </div>
  </section>`;
}

function renderSession(session: SessionRecord): string {
  const status = session.isArchived ? "Archived" : "Completed";
  const providerLabel = session.modelProvider ?? "Local";
  const relativeTime = formatRelativeTime(session.updatedAt);
  const contextLabel = session.cwd ? path.basename(session.cwd) : "Unknown";

  return `<article class="session" tabindex="0" role="button" data-restore="${escapeHtml(session.id)}" title="${escapeHtml(session.title ?? session.id)}">
    <div class="session-main">
      <div class="dot"></div>
      <div class="session-title">${escapeHtml(session.title ?? session.id)}</div>
      <div class="session-aside">${escapeHtml(`${providerLabel} · ${relativeTime}`)}</div>
    </div>
    <div class="session-meta">
      <div class="session-status">${escapeHtml(status)}</div>
      <div>${escapeHtml(contextLabel)}</div>
    </div>
    <div class="session-actions">
      <button class="action" data-action="preview" data-session-id="${escapeHtml(session.id)}" type="button">Preview</button>
    </div>
  </article>`;
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

function getGroupKey(updatedAt: string | null): SessionGroupKey {
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  if (!Number.isFinite(updatedAtMs)) {
    return "older";
  }

  const ageMs = Date.now() - updatedAtMs;
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (isSameDay(updatedAtMs, Date.now())) {
    return "today";
  }

  if (ageMs <= 7 * oneDayMs) {
    return "last7d";
  }

  if (ageMs <= 30 * oneDayMs) {
    return "last30d";
  }

  return "older";
}

function isSameDay(leftMs: number, rightMs: number): boolean {
  const left = new Date(leftMs);
  const right = new Date(rightMs);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatRelativeTime(updatedAt: string | null): string {
  if (!updatedAt) {
    return "unknown";
  }

  const updatedAtMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return "unknown";
  }

  const diffMs = Math.max(0, Date.now() - updatedAtMs);
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  if (diffMs < hourMs) {
    const mins = Math.max(1, Math.round(diffMs / (60 * 1000)));
    return `${mins} min`;
  }

  if (diffMs < dayMs) {
    return `${Math.round(diffMs / hourMs)} hrs`;
  }

  return `${Math.round(diffMs / dayMs)} days`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createNonce(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return value;
}
