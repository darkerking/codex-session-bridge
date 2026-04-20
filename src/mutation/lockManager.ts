import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const LOCK_DIR = "locks";
const GLOBAL_MUTATION_LOCK = "global-mutation.lock";

export class LockManager {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async acquireGlobalMutationLock(): Promise<string> {
    const lockPath = this.getLockPath();
    await fs.mkdir(path.dirname(lockPath), { recursive: true });

    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ createdAt: new Date().toISOString() }));
      await handle.close();
      return lockPath;
    } catch (error) {
      throw new Error(
        `Another mutation appears to be running. Lock path: ${lockPath}. Details: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  public async releaseGlobalMutationLock(): Promise<void> {
    try {
      await fs.unlink(this.getLockPath());
    } catch {
      // Ignore missing lock cleanup.
    }
  }

  private getLockPath(): string {
    return path.join(
      this.context.globalStorageUri.fsPath,
      LOCK_DIR,
      GLOBAL_MUTATION_LOCK
    );
  }
}
