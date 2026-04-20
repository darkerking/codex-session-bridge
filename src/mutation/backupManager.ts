import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { BackupFileEntry, BackupManifest } from "../shared/types";

const BACKUP_DIR = "backups";
const MANIFESTS_DIR = "manifests";

export class BackupManager {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async createBackup(
    reason: string,
    filePaths: string[]
  ): Promise<BackupManifest> {
    const id = `backup-${Date.now()}-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const backupRoot = path.join(this.context.globalStorageUri.fsPath, BACKUP_DIR, id);

    await fs.mkdir(backupRoot, { recursive: true });

    const files: BackupFileEntry[] = [];
    for (const originalPath of unique(filePaths)) {
      const stat = await safeStat(originalPath);
      if (!stat?.isFile()) {
        continue;
      }

      const backupPath = path.join(backupRoot, encodeFilePath(originalPath));
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(originalPath, backupPath);

      files.push({
        originalPath,
        backupPath,
        checksum: await computeFileChecksum(backupPath)
      });
    }

    const manifest: BackupManifest = {
      id,
      createdAt,
      reason,
      files
    };

    await this.writeManifest(manifest);
    return manifest;
  }

  public async loadManifest(backupId: string): Promise<BackupManifest | null> {
    const manifestPath = this.getManifestPath(backupId);
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      return JSON.parse(raw) as BackupManifest;
    } catch {
      return null;
    }
  }

  private async writeManifest(manifest: BackupManifest): Promise<void> {
    const manifestPath = this.getManifestPath(manifest.id);
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  private getManifestPath(backupId: string): string {
    return path.join(
      this.context.globalStorageUri.fsPath,
      BACKUP_DIR,
      MANIFESTS_DIR,
      `${backupId}.json`
    );
  }
}

function encodeFilePath(filePath: string): string {
  return filePath.replace(/[:\\\/]/g, "__");
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function safeStat(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
