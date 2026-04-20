import * as os from "node:os";
import * as path from "node:path";

export const CODEX_HOME = path.join(os.homedir(), ".codex");

export const SESSION_DIRECTORIES = [
  {
    sourceKind: "session" as const,
    path: path.join(CODEX_HOME, "sessions")
  },
  {
    sourceKind: "archived_session" as const,
    path: path.join(CODEX_HOME, "archived_sessions")
  }
];

export const SESSION_INDEX_FILE = path.join(CODEX_HOME, "session_index.jsonl");

export const RECOVERY_DIR_NAME = "recovery-packages";
export const STATE_DB_NAME = "state_5.sqlite";
export const STATE_DB_SHM_NAME = "state_5.sqlite-shm";
export const STATE_DB_WAL_NAME = "state_5.sqlite-wal";

export const CODEX_COMMANDS = {
  openSidebar: "chatgpt.openSidebar",
  newPanel: "chatgpt.newCodexPanel",
  newChat: "chatgpt.newChat"
} as const;

export const OFFICIAL_CODEX_EXTENSION_ID = "openai.chatgpt";
