export type SessionSourceKind = "session" | "archived_session";

export interface SessionRecord {
  id: string;
  title: string | null;
  preview: string | null;
  cwd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  modelProvider: string | null;
  model: string | null;
  sourcePath: string;
  sourceKind: SessionSourceKind;
  isArchived: boolean;
  isVisibleInOfficialUi?: boolean | null;
  canRestore: boolean;
  hasExperimentalMutation: boolean;
  lineCount?: number;
}

export type SessionArchiveFilter = "all" | "active" | "archived";

export type SessionTimeFilter = "all" | "7d" | "30d" | "90d";

export interface SessionFilterState {
  provider: string | null;
  cwd: string | null;
  archived: SessionArchiveFilter;
  timeWindow: SessionTimeFilter;
}

export interface MutationRecord {
  id: string;
  type: "provider_sync" | "rollback";
  createdAt: string;
  status: "started" | "completed" | "failed" | "rolled_back";
  affectedSessionIds: string[];
  affectedFiles: string[];
  backupId: string;
  notes?: string;
}

export interface BackupFileEntry {
  originalPath: string;
  backupPath: string;
  checksum?: string;
}

export interface BackupManifest {
  id: string;
  createdAt: string;
  reason: string;
  files: BackupFileEntry[];
}

export interface SessionMetaPayload {
  id: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  source?: string;
  model_provider?: string;
  model?: string;
}

export interface SessionTitleIndexEntry {
  id: string;
  threadName: string | null;
  updatedAt: string | null;
}

export interface RecoveryTurn {
  role: "user" | "assistant" | "system";
  text: string;
  timestamp?: string;
}

export interface RecoveryPackage {
  markdownPath: string;
  jsonPath: string;
  turns: RecoveryTurn[];
}

export interface VisibilitySyncPlan {
  sessionId: string;
  sourceProvider: string | null;
  targetProvider: string;
  rolloutPath: string;
}
