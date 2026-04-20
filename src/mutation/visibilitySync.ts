import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VisibilitySyncPlan } from "../shared/types";
import { normalizeProvider } from "../shared/utils";

const execFileAsync = promisify(execFile);

export class VisibilitySync {
  public async buildPlan(
    sessionId: string,
    rolloutPath: string,
    currentProvider: string | null
  ): Promise<VisibilitySyncPlan> {
    const sourceProvider = await readRolloutProvider(rolloutPath);
    const targetProvider = normalizeProvider(currentProvider);

    if (!targetProvider) {
      throw new Error("Could not determine the active provider from local state.");
    }

    if (normalizeProvider(sourceProvider) === targetProvider) {
      throw new Error("The selected session is already using the active provider.");
    }

    return {
      sessionId,
      sourceProvider,
      targetProvider,
      rolloutPath
    };
  }

  public async apply(
    stateDbPath: string,
    plan: VisibilitySyncPlan
  ): Promise<void> {
    await updateRolloutProvider(plan.rolloutPath, plan.targetProvider);
    await updateThreadProvider(stateDbPath, plan.sessionId, plan.targetProvider);
    await this.verifyApplied(stateDbPath, plan);
  }

  public async getMostRecentProvider(stateDbPath: string): Promise<string | null> {
    const row = await runPythonSqlite<{ model_provider: string | null }>(
      `
import sqlite3, json
conn = sqlite3.connect(db_path)
cur = conn.cursor()
row = cur.execute("select model_provider from threads order by updated_at_ms desc limit 1").fetchone()
conn.close()
print(json.dumps({"model_provider": row[0] if row else None}, ensure_ascii=False))
      `,
      stateDbPath
    );

    return normalizeProvider(row.model_provider);
  }

  public async getSessionProvider(
    stateDbPath: string,
    sessionId: string
  ): Promise<string | null> {
    const row = await runPythonSqlite<{ model_provider: string | null }>(
      `
import sqlite3, json
conn = sqlite3.connect(db_path)
cur = conn.cursor()
row = cur.execute(
    "select model_provider from threads where id = ? limit 1",
    (session_id,)
).fetchone()
conn.close()
print(json.dumps({"model_provider": row[0] if row else None}, ensure_ascii=False))
      `,
      stateDbPath,
      { session_id: sessionId }
    );

    return normalizeProvider(row.model_provider);
  }

  private async verifyApplied(
    stateDbPath: string,
    plan: VisibilitySyncPlan
  ): Promise<void> {
    const rolloutProvider = normalizeProvider(
      await readRolloutProvider(plan.rolloutPath)
    );
    if (rolloutProvider !== plan.targetProvider) {
      throw new Error(
        `Rollout verification failed. Expected provider ${plan.targetProvider}, got ${rolloutProvider ?? "null"}.`
      );
    }

    const threadProvider = await this.getSessionProvider(stateDbPath, plan.sessionId);
    if (threadProvider !== plan.targetProvider) {
      throw new Error(
        `SQLite verification failed. Expected provider ${plan.targetProvider}, got ${threadProvider ?? "null"}.`
      );
    }
  }
}

async function readRolloutProvider(rolloutPath: string): Promise<string | null> {
  const firstLine = (await fs.readFile(rolloutPath, "utf8")).split(/\r?\n/, 1)[0];
  const parsed = JSON.parse(firstLine) as {
    payload?: { model_provider?: string | null };
  };
  return normalizeProvider(parsed.payload?.model_provider);
}

async function updateRolloutProvider(
  rolloutPath: string,
  targetProvider: string
): Promise<void> {
  const raw = await fs.readFile(rolloutPath, "utf8");
  const lines = raw.split(/\r?\n/);
  if (!lines[0]) {
    throw new Error(`Missing session_meta in rollout file: ${rolloutPath}`);
  }

  const first = JSON.parse(lines[0]) as {
    payload?: { model_provider?: string };
  };
  if (!first.payload) {
    throw new Error(`Invalid session_meta payload in rollout file: ${rolloutPath}`);
  }

  first.payload.model_provider = targetProvider;
  lines[0] = JSON.stringify(first);
  await fs.writeFile(rolloutPath, lines.join("\n"), "utf8");
}

async function updateThreadProvider(
  stateDbPath: string,
  sessionId: string,
  targetProvider: string
): Promise<void> {
  await runPythonSqlite(
    `
import sqlite3
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute(
    "update threads set model_provider = ?, updated_at_ms = ? where id = ?",
    (target_provider, int(timestamp_ms), session_id)
)
conn.commit()
conn.close()
print("{}")
    `,
    stateDbPath,
    {
      target_provider: targetProvider,
      timestamp_ms: String(Date.now()),
      session_id: sessionId
    }
  );
}

async function runPythonSqlite<T>(
  scriptBody: string,
  dbPath: string,
  variables: Record<string, string> = {}
): Promise<T> {
  const bootstrap = `
import json, sys
db_path = sys.argv[1]
vars_json = sys.argv[2]
vars_dict = json.loads(vars_json)
for key, value in vars_dict.items():
    globals()[key] = value
${scriptBody}
  `.trim();

  const { stdout, stderr } = await execFileAsync(
    "python",
    ["-c", bootstrap, dbPath, JSON.stringify(variables)],
    {
      windowsHide: true
    }
  );

  if (stderr?.trim()) {
    throw new Error(stderr.trim());
  }

  const trimmed = stdout.trim();
  return JSON.parse(trimmed) as T;
}
