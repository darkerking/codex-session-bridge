import * as path from "node:path";
import type {
  SessionMetaPayload,
  SessionRecord,
  SessionSourceKind,
  SessionTitleIndexEntry
} from "../shared/types";

interface SessionMetaLine {
  timestamp?: string;
  type?: string;
  payload?: SessionMetaPayload;
}

export function parseSessionMetaLine(
  rawLine: string,
  sourcePath: string,
  sourceKind: SessionSourceKind,
  statInfo: { updatedAt: string | null; createdAt: string | null },
  titleEntry?: SessionTitleIndexEntry
): SessionRecord | null {
  const trimmed = rawLine.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: SessionMetaLine;
  try {
    parsed = JSON.parse(trimmed) as SessionMetaLine;
  } catch {
    return null;
  }

  if (parsed.type !== "session_meta" || !parsed.payload?.id) {
    return null;
  }

  const payload = parsed.payload;
  const createdAt = payload.timestamp ?? statInfo.createdAt;
  const updatedAt = titleEntry?.updatedAt ?? statInfo.updatedAt;
  const title = deriveTitle(payload, sourcePath, titleEntry);

  return {
    id: payload.id,
    title,
    preview: null,
    cwd: payload.cwd ?? null,
    createdAt,
    updatedAt,
    modelProvider: payload.model_provider ?? null,
    model: payload.model ?? null,
    sourcePath,
    sourceKind,
    isArchived: sourceKind === "archived_session",
    isVisibleInOfficialUi: null,
    canRestore: true,
    hasExperimentalMutation: false
  };
}

function deriveTitle(
  payload: SessionMetaPayload,
  sourcePath: string,
  titleEntry?: SessionTitleIndexEntry
): string {
  if (titleEntry?.threadName && titleEntry.threadName.trim().length > 0) {
    return titleEntry.threadName.trim();
  }

  const cwdBase = payload.cwd ? path.basename(payload.cwd) : null;
  if (cwdBase && cwdBase.trim().length > 0) {
    return `${cwdBase} (${payload.id.slice(0, 8)})`;
  }

  return path.basename(sourcePath, path.extname(sourcePath));
}
