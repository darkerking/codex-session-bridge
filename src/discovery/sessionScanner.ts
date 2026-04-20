import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  CODEX_HOME,
  SESSION_DIRECTORIES,
  SESSION_INDEX_FILE,
  STATE_DB_NAME
} from "../shared/constants";
import { parseSessionMetaLine } from "./sessionMetaParser";
import type {
  SessionRecord,
  SessionSourceKind,
  SessionTitleIndexEntry
} from "../shared/types";

const execFileAsync = promisify(execFile);

export class SessionScanner {
  public constructor(private readonly codexHome: string = CODEX_HOME) {}

  public async scanSessions(): Promise<SessionRecord[]> {
    const titleIndex = await this.loadTitleIndex();
    const sessions: SessionRecord[] = [];

    for (const directory of SESSION_DIRECTORIES) {
      const rootDir =
        directory.path.startsWith(CODEX_HOME) && this.codexHome !== CODEX_HOME
          ? directory.path.replace(CODEX_HOME, this.codexHome)
          : directory.path;

      const files = await this.collectJsonlFiles(rootDir);
      for (const file of files) {
        const session = await this.parseSessionFile(
          file,
          directory.sourceKind,
          titleIndex
        );
        if (session) {
          sessions.push(session);
        }
      }
    }

    return sessions.sort(compareSessionsByUpdatedAt);
  }

  private async parseSessionFile(
    filePath: string,
    sourceKind: SessionSourceKind,
    titleIndex: Map<string, SessionTitleIndexEntry>
  ): Promise<SessionRecord | null> {
    const stats = await fs.stat(filePath);
    const firstLine = await readFirstLine(filePath);
    if (!firstLine) {
      return null;
    }

    const draft = parseSessionMetaLine(
      firstLine,
      filePath,
      sourceKind,
      {
        createdAt: stats.birthtime?.toISOString?.() ?? null,
        updatedAt: stats.mtime?.toISOString?.() ?? null
      },
      undefined
    );

    if (!draft) {
      return null;
    }

    const titled = parseSessionMetaLine(
      firstLine,
      filePath,
      sourceKind,
      {
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt
      },
      titleIndex.get(draft.id)
    );

    if (!titled) {
      return null;
    }

    if (shouldReplaceTitle(titled)) {
      const inferredTitle = await extractMeaningfulTitleFromSession(filePath);
      if (inferredTitle) {
        titled.title = inferredTitle;
      }
    }

    titled.lineCount = await countApproximateLines(filePath);
    return titled;
  }

  private async collectJsonlFiles(rootDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(rootDir, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(rootDir, entry.name);
          if (entry.isDirectory()) {
            return this.collectJsonlFiles(entryPath);
          }
          if (entry.isFile() && entry.name.endsWith(".jsonl")) {
            return [entryPath];
          }
          return [];
        })
      );
      return files.flat();
    } catch {
      return [];
    }
  }

  private async loadTitleIndex(): Promise<Map<string, SessionTitleIndexEntry>> {
    const result = new Map<string, SessionTitleIndexEntry>();
    await this.loadSqliteTitles(result);
    await this.loadSessionIndexTitles(result);
    return result;
  }

  private async loadSessionIndexTitles(
    result: Map<string, SessionTitleIndexEntry>
  ): Promise<void> {
    const indexPath =
      this.codexHome === CODEX_HOME
        ? SESSION_INDEX_FILE
        : path.join(this.codexHome, "session_index.jsonl");

    let raw: string;
    try {
      raw = await fs.readFile(indexPath, "utf8");
    } catch {
      return;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed) as {
          id?: string;
          thread_name?: string;
          updated_at?: string;
        };
        if (!parsed.id) {
          continue;
        }
        result.set(parsed.id, {
          id: parsed.id,
          threadName: parsed.thread_name ?? null,
          updatedAt: parsed.updated_at ?? null
        });
      } catch {
        // Skip malformed index lines and keep scanning.
      }
    }
  }

  private async loadSqliteTitles(
    result: Map<string, SessionTitleIndexEntry>
  ): Promise<void> {
    const dbPath =
      this.codexHome === CODEX_HOME
        ? path.join(CODEX_HOME, STATE_DB_NAME)
        : path.join(this.codexHome, STATE_DB_NAME);

    let rows: Array<{
      id?: string;
      title?: string | null;
      updated_at_ms?: number | string | null;
    }>;
    try {
      rows = await runPythonSqlite<Array<{
        id?: string;
        title?: string | null;
        updated_at_ms?: number | string | null;
      }>>(
        `
import sqlite3, json
conn = sqlite3.connect(db_path)
cur = conn.cursor()
rows = cur.execute(
    "select id, title, updated_at_ms from threads where title is not null and trim(title) != ''"
).fetchall()
conn.close()
print(json.dumps(
    [{"id": row[0], "title": row[1], "updated_at_ms": row[2]} for row in rows],
    ensure_ascii=True
))
        `,
        dbPath
      );
    } catch {
      return;
    }

    for (const row of rows) {
      if (!row.id || !row.title?.trim()) {
        continue;
      }

      result.set(row.id, {
        id: row.id,
        threadName: row.title.trim(),
        updatedAt: normalizeUpdatedAt(row.updated_at_ms)
      });
    }
  }
}

async function readFirstLine(filePath: string): Promise<string | null> {
  const handle = await fs.open(filePath, "r");
  try {
    const chunkSize = 65536;
    const chunks: Buffer[] = [];
    let position = 0;

    while (true) {
      const buffer = Buffer.alloc(chunkSize);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }

      const chunk = buffer.subarray(0, bytesRead);
      chunks.push(chunk);
      const content = Buffer.concat(chunks).toString("utf8");
      const newlineIndex = content.indexOf("\n");
      if (newlineIndex >= 0) {
        return content.slice(0, newlineIndex).replace(/\r$/, "");
      }

      position += bytesRead;
    }

    if (!chunks.length) {
      return null;
    }

    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function countApproximateLines(filePath: string): Promise<number | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw) {
      return 0;
    }
    return raw.split(/\r?\n/).length;
  } catch {
    return undefined;
  }
}

function compareSessionsByUpdatedAt(a: SessionRecord, b: SessionRecord): number {
  const aValue = a.updatedAt ? Date.parse(a.updatedAt) : 0;
  const bValue = b.updatedAt ? Date.parse(b.updatedAt) : 0;
  return bValue - aValue;
}

function shouldReplaceTitle(session: SessionRecord): boolean {
  const title = session.title?.trim();
  if (!title) {
    return true;
  }

  const cwdBase = session.cwd ? path.basename(session.cwd) : null;
  const genericProjectTitle =
    cwdBase && (title === cwdBase || title === `${cwdBase} (${session.id.slice(0, 8)})`);

  if (genericProjectTitle) {
    return true;
  }

  const suspiciousPatterns = [
    /^</,
    /to=final/i,
    /to=functions/i,
    /<instructions>/i,
    /please disregard/i,
    /[{}\][`]{2,}/,
    /[{}[\]`]{4,}/
  ];

  return suspiciousPatterns.some((pattern) => pattern.test(title));
}

function normalizeUpdatedAt(
  updatedAtMs: number | string | null | undefined
): string | null {
  const numericValue =
    typeof updatedAtMs === "number"
      ? updatedAtMs
      : typeof updatedAtMs === "string"
        ? Number(updatedAtMs)
        : Number.NaN;

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return new Date(numericValue).toISOString();
}

async function runPythonSqlite<T>(
  scriptBody: string,
  dbPath: string
): Promise<T> {
  const bootstrap = `
import sys
db_path = sys.argv[1]
${scriptBody}
  `.trim();

  const { stdout, stderr } = await execFileAsync(
    "python",
    ["-c", bootstrap, dbPath],
    {
      windowsHide: true
    }
  );

  if (stderr?.trim()) {
    throw new Error(stderr.trim());
  }

  return JSON.parse(stdout.trim()) as T;
}

async function extractMeaningfulTitleFromSession(
  filePath: string
): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: {
      type?: string;
      payload?: {
        type?: string;
        role?: string;
        message?: string;
        content?: Array<{ text?: string }>;
      };
    };
    try {
      parsed = JSON.parse(trimmed) as {
        type?: string;
        payload?: {
          type?: string;
          role?: string;
          message?: string;
          content?: Array<{ text?: string }>;
        };
      };
    } catch {
      continue;
    }

    const candidate = extractCandidateTitle(parsed);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function extractCandidateTitle(parsed: {
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    message?: string;
    content?: Array<{ text?: string }>;
  };
}): string | null {
  const payload = parsed.payload;
  if (!payload) {
    return null;
  }

  if (parsed.type === "response_item" && payload.type === "message" && payload.role === "user") {
    const text = (payload.content ?? [])
      .map((entry) => entry.text?.trim() ?? "")
      .filter((entry) => entry.length > 0)
      .join("\n\n");
    return normalizeTitleCandidate(text);
  }

  if (parsed.type === "event_msg" && payload.type === "user_message") {
    return normalizeTitleCandidate(payload.message ?? "");
  }

  return null;
}

function normalizeTitleCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  if (/^# AGENTS\.md instructions\b/i.test(trimmed)) {
    return null;
  }

  const requestMatch = trimmed.match(
    /## My request for Codex:\s*([\s\S]+)/i
  );
  const prioritized = requestMatch?.[1]?.trim() ?? trimmed;

  const lines = prioritized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !shouldIgnoreCandidateLine(line));

  for (const line of lines) {
    const sanitized = sanitizeTitleLine(line);
    if (sanitized) {
      return sanitized;
    }
  }

  return null;
}

function shouldIgnoreCandidateLine(line: string): boolean {
  return (
    /^# Context from my IDE setup:/i.test(line) ||
    /^## Active file:/i.test(line) ||
    /^## Open tabs:/i.test(line) ||
    /^<environment[_ ]context>?/i.test(line) ||
    /^<INSTRUCTIONS>$/i.test(line) ||
    /^<\/INSTRUCTIONS>$/i.test(line)
  );
}

function sanitizeTitleLine(line: string): string | null {
  const collapsed = line.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return null;
  }

  const cleaned = collapsed
    .replace(/[`#>*_]+/g, " ")
    .replace(/[{}\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 2) {
    return null;
  }

  if (/^(active file|open tabs|instructions)$/i.test(cleaned)) {
    return null;
  }

  if (/^</.test(cleaned) || /^<environment\b/i.test(cleaned)) {
    return null;
  }

  const pathStart = cleaned.search(/[A-Za-z]:\\/);
  if (pathStart >= 0) {
    const rawPath = cleaned.slice(pathStart).trim();
    const baseName = path.win32.basename(rawPath);
    if (baseName) {
      return baseName.slice(0, 80);
    }
  }

  return cleaned.slice(0, 80);
}
