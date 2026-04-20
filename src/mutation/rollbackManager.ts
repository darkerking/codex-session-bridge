import * as fs from "node:fs/promises";
import type { BackupManifest } from "../shared/types";

export class RollbackManager {
  public async rollback(manifest: BackupManifest): Promise<string[]> {
    const restored: string[] = [];
    for (const file of manifest.files) {
      await fs.copyFile(file.backupPath, file.originalPath);
      restored.push(file.originalPath);
    }
    return restored;
  }
}
