import * as path from "node:path";
import * as vscode from "vscode";
import { SessionScanner } from "../discovery/sessionScanner";
import { SessionIndex } from "../indexing/sessionIndex";
import { RecoveryPackageBuilder } from "../recovery/recoveryPackageBuilder";
import { CodexCommands } from "../integration/codexCommands";
import { BackupManager } from "../mutation/backupManager";
import { LockManager } from "../mutation/lockManager";
import { RollbackManager } from "../mutation/rollbackManager";
import { VisibilitySync } from "../mutation/visibilitySync";
import { LogStore } from "../persistence/logStore";
import {
  CODEX_HOME,
  STATE_DB_NAME,
  STATE_DB_SHM_NAME,
  STATE_DB_WAL_NAME
} from "../shared/constants";
import { createOperationId } from "../shared/utils";
import type {
  MutationRecord,
  RecoveryPackage,
  SessionRecord
} from "../shared/types";

const LAST_MUTATION_KEY = "codexSessionBridge.lastMutationRecord";

export class SessionBridgeService {
  private readonly sessionIndex = new SessionIndex(new SessionScanner());
  private readonly recoveryPackageBuilder = new RecoveryPackageBuilder();
  private readonly codexCommands = new CodexCommands();

  public async refreshSessions(): Promise<SessionRecord[]> {
    return this.sessionIndex.refresh();
  }

  public getSessions(): SessionRecord[] {
    return this.sessionIndex.getAll();
  }

  public getSessionById(id: string): SessionRecord | undefined {
    return this.sessionIndex.getById(id);
  }

  public async buildRecoveryPackage(
    context: vscode.ExtensionContext,
    session: SessionRecord
  ): Promise<RecoveryPackage> {
    return this.recoveryPackageBuilder.build(context, session);
  }

  public async buildSessionPreview(session: SessionRecord): Promise<string> {
    return this.recoveryPackageBuilder.buildPreviewMarkdown(session);
  }

  public async restoreSessionToCodex(
    context: vscode.ExtensionContext,
    session: SessionRecord
  ): Promise<{
    recoveryPackage: RecoveryPackage;
    attachedToCodex: boolean;
  }> {
    const recoveryPackage = await this.buildRecoveryPackage(context, session);
    const attachedToCodex = await this.codexCommands.restoreRecoveryFile(
      recoveryPackage.markdownPath
    );

    return {
      recoveryPackage,
      attachedToCodex
    };
  }

  public async syncSessionVisibility(
    context: vscode.ExtensionContext,
    session: SessionRecord
  ): Promise<MutationRecord> {
    const backupManager = new BackupManager(context);
    const lockManager = new LockManager(context);
    const rollbackManager = new RollbackManager();
    const visibilitySync = new VisibilitySync();
    const logStore = new LogStore(context);

    const sessionStateDbPath = path.join(CODEX_HOME, STATE_DB_NAME);
    const stateDbShmPath = path.join(CODEX_HOME, STATE_DB_SHM_NAME);
    const stateDbWalPath = path.join(CODEX_HOME, STATE_DB_WAL_NAME);
    const targetProvider = await visibilitySync.getMostRecentProvider(sessionStateDbPath);
    const plan = await visibilitySync.buildPlan(
      session.id,
      session.sourcePath,
      targetProvider
    );

    const mutation: MutationRecord = {
      id: createOperationId("provider-sync"),
      type: "provider_sync",
      createdAt: new Date().toISOString(),
      status: "started",
      affectedSessionIds: [session.id],
      affectedFiles: [session.sourcePath, sessionStateDbPath],
      backupId: "",
      notes: `Sync provider from ${plan.sourceProvider ?? "unknown"} to ${plan.targetProvider}`
    };

    await logStore.appendMutation(mutation);

    await lockManager.acquireGlobalMutationLock();
    try {
      const backupManifest = await backupManager.createBackup(
        `provider sync for session ${session.id}`,
        [session.sourcePath, sessionStateDbPath, stateDbShmPath, stateDbWalPath]
      );
      mutation.backupId = backupManifest.id;

      await visibilitySync.apply(sessionStateDbPath, plan);

      mutation.status = "completed";
      await logStore.appendMutation(mutation);
      await context.globalState.update(LAST_MUTATION_KEY, mutation);

      await this.refreshSessions();
      return mutation;
    } catch (error) {
      mutation.status = "failed";
      mutation.notes = `${mutation.notes ?? ""}\n${String(
        error instanceof Error ? error.message : error
      )}`.trim();
      await logStore.appendMutation(mutation);

      if (mutation.backupId) {
        const backupManifest = await backupManager.loadManifest(mutation.backupId);
        if (backupManifest) {
          await rollbackManager.rollback(backupManifest);
        }
      }

      throw error;
    } finally {
      await lockManager.releaseGlobalMutationLock();
    }
  }

  public async rollbackLastMutation(
    context: vscode.ExtensionContext
  ): Promise<MutationRecord | null> {
    const lastMutation = context.globalState.get<MutationRecord | null>(
      LAST_MUTATION_KEY,
      null
    );
    if (!lastMutation?.id) {
      return null;
    }

    return this.rollbackMutation(context, lastMutation.id);
  }

  public async listRollbackCandidates(
    context: vscode.ExtensionContext
  ): Promise<MutationRecord[]> {
    const logStore = new LogStore(context);
    const records = await logStore.listMutations();
    const latestById = getLatestMutationMap(records);

    return [...latestById.values()]
      .filter(
        (record) =>
          record.type === "provider_sync" &&
          record.status === "completed" &&
          Boolean(record.backupId)
      )
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  public async buildMutationHistoryMarkdown(
    context: vscode.ExtensionContext
  ): Promise<string> {
    const logStore = new LogStore(context);
    const records = await logStore.listMutations();
    const latestById = [...getLatestMutationMap(records).values()].sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );

    const lines = [
      "# Mutation History",
      "",
      `- Total log records: ${records.length}`,
      `- Latest mutation states: ${latestById.length}`,
      ""
    ];

    if (!latestById.length) {
      lines.push("_No mutation history is available yet._", "");
      return lines.join("\n");
    }

    for (const record of latestById) {
      lines.push(`## ${record.id}`);
      lines.push("");
      lines.push(`- Type: ${record.type}`);
      lines.push(`- Status: ${record.status}`);
      lines.push(`- Created At: ${record.createdAt}`);
      lines.push(`- Backup ID: ${record.backupId || "none"}`);
      lines.push(`- Sessions: ${record.affectedSessionIds.join(", ") || "none"}`);
      lines.push(`- Files: ${record.affectedFiles.length}`);
      if (record.notes) {
        lines.push(`- Notes: ${record.notes}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  public async rollbackMutation(
    context: vscode.ExtensionContext,
    mutationId: string
  ): Promise<MutationRecord> {
    const backupManager = new BackupManager(context);
    const rollbackManager = new RollbackManager();
    const logStore = new LogStore(context);
    const lockManager = new LockManager(context);

    const targetMutation = await this.getRollbackTarget(logStore, mutationId);
    const restoreManifest = await backupManager.loadManifest(targetMutation.backupId);
    if (!restoreManifest) {
      throw new Error(`Could not find backup manifest: ${targetMutation.backupId}`);
    }

    await lockManager.acquireGlobalMutationLock();
    try {
      const rollbackBackup = await backupManager.createBackup(
        `pre rollback snapshot for mutation ${targetMutation.id}`,
        restoreManifest.files.map((file) => file.originalPath)
      );

      const rollbackRecord: MutationRecord = {
        id: createOperationId("rollback"),
        type: "rollback",
        createdAt: new Date().toISOString(),
        status: "started",
        affectedSessionIds: targetMutation.affectedSessionIds,
        affectedFiles: restoreManifest.files.map((file) => file.originalPath),
        backupId: rollbackBackup.id,
        notes: `Rollback for mutation ${targetMutation.id} using backup ${targetMutation.backupId}`
      };

      await logStore.appendMutation(rollbackRecord);
      await rollbackManager.rollback(restoreManifest);

      rollbackRecord.status = "completed";
      await logStore.appendMutation(rollbackRecord);
      await logStore.appendMutation({
        ...targetMutation,
        status: "rolled_back",
        notes: `${targetMutation.notes ?? ""}\nRolled back by ${rollbackRecord.id}`.trim()
      });

      const lastMutation = context.globalState.get<MutationRecord | null>(
        LAST_MUTATION_KEY,
        null
      );
      if (lastMutation?.id === targetMutation.id) {
        await context.globalState.update(LAST_MUTATION_KEY, null);
      }

      await this.refreshSessions();
      return rollbackRecord;
    } finally {
      await lockManager.releaseGlobalMutationLock();
    }
  }

  private async getRollbackTarget(
    logStore: LogStore,
    mutationId: string
  ): Promise<MutationRecord> {
    const records = await logStore.listMutations();
    const latestById = getLatestMutationMap(records);
    const mutation = latestById.get(mutationId);

    if (!mutation) {
      throw new Error(`Could not find mutation record: ${mutationId}`);
    }

    if (mutation.type !== "provider_sync") {
      throw new Error(`Mutation ${mutationId} is not a rollback candidate.`);
    }

    if (mutation.status !== "completed") {
      throw new Error(`Mutation ${mutationId} is not in a completed state.`);
    }

    if (!mutation.backupId) {
      throw new Error(`Mutation ${mutationId} does not have a backup manifest.`);
    }

    return mutation;
  }
}

function getLatestMutationMap(
  records: MutationRecord[]
): Map<string, MutationRecord> {
  const latestById = new Map<string, MutationRecord>();

  for (const record of records) {
    latestById.set(record.id, record);
  }

  return latestById;
}
