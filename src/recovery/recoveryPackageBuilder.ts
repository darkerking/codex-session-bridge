import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { RECOVERY_DIR_NAME } from "../shared/constants";
import type { RecoveryPackage, RecoveryTurn, SessionRecord } from "../shared/types";

interface SessionJsonlLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    message?: string;
  };
}

export class RecoveryPackageBuilder {
  public async buildPreviewMarkdown(session: SessionRecord): Promise<string> {
    const turns = await extractTurns(session.sourcePath);
    return buildMarkdown(session, turns.slice(0, 12), "Session Preview");
  }

  public async build(
    context: vscode.ExtensionContext,
    session: SessionRecord
  ): Promise<RecoveryPackage> {
    const turns = await extractTurns(session.sourcePath);
    const recoveryDir = path.join(
      context.globalStorageUri.fsPath,
      RECOVERY_DIR_NAME,
      session.id
    );

    await fs.mkdir(recoveryDir, { recursive: true });

    const markdownPath = path.join(recoveryDir, "session-restore.md");
    const jsonPath = path.join(recoveryDir, "session-restore.json");

    await fs.writeFile(markdownPath, buildMarkdown(session, turns), "utf8");
    await fs.writeFile(
      jsonPath,
      JSON.stringify(
        {
          session,
          turns
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      markdownPath,
      jsonPath,
      turns
    };
  }
}

async function extractTurns(filePath: string): Promise<RecoveryTurn[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const turns: RecoveryTurn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: SessionJsonlLine;
    try {
      parsed = JSON.parse(trimmed) as SessionJsonlLine;
    } catch {
      continue;
    }

    const payload = parsed.payload;
    if (!payload) {
      continue;
    }

    if (parsed.type === "response_item" && payload.type === "message") {
      const role = normalizeRole(payload.role);
      const text = extractContentText(payload.content);
      if (role && text) {
        turns.push({ role, text, timestamp: parsed.timestamp });
      }
      continue;
    }

    if (parsed.type === "event_msg" && typeof payload.message === "string") {
      const role = inferRoleFromEventType(payload.type);
      if (role) {
        turns.push({ role, text: payload.message, timestamp: parsed.timestamp });
      }
    }
  }

  return turns;
}

function buildMarkdown(
  session: SessionRecord,
  turns: RecoveryTurn[],
  title = "Session Restore Package"
): string {
  const header = [
    `# ${title}`,
    "",
    "## Session Metadata",
    "",
    `- Session ID: ${session.id}`,
    `- Title: ${session.title ?? "Unknown"}`,
    `- Working Directory: ${session.cwd ?? "Unknown"}`,
    `- Source File: ${session.sourcePath}`,
    `- Provider: ${session.modelProvider ?? "Unknown"}`,
    `- Created At: ${session.createdAt ?? "Unknown"}`,
    `- Updated At: ${session.updatedAt ?? "Unknown"}`,
    "",
    "## Restore Guidance",
    "",
    "Use the history below as the local conversation context for this project.",
    "Treat it as prior work state from the same machine, even if the current account is different.",
    ""
  ];

  const conversation = turns.length
    ? [
        "## Conversation History",
        "",
        ...turns.flatMap((turn, index) => [
          `### ${index + 1}. ${turn.role.toUpperCase()}`,
          "",
          turn.text,
          ""
        ])
      ]
    : ["## Conversation History", "", "_No restorable turns were extracted from this session._", ""];

  return [...header, ...conversation].join("\n");
}

function normalizeRole(role?: string): RecoveryTurn["role"] | null {
  if (role === "user" || role === "assistant" || role === "system") {
    return role;
  }
  return null;
}

function inferRoleFromEventType(eventType?: string): RecoveryTurn["role"] | null {
  if (eventType === "user_message") {
    return "user";
  }
  if (eventType === "agent_message") {
    return "assistant";
  }
  return null;
}

function extractContentText(
  content?: Array<{ type?: string; text?: string }>
): string | null {
  if (!content?.length) {
    return null;
  }

  const text = content
    .filter((entry) => typeof entry.text === "string" && entry.text.trim().length > 0)
    .map((entry) => entry.text?.trim() ?? "")
    .join("\n\n")
    .trim();

  return text.length > 0 ? text : null;
}
