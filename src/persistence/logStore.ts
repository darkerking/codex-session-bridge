import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import type { MutationRecord } from "../shared/types";

const LOG_DIR = "logs";
const MUTATION_LOG_FILE = "mutations.jsonl";

export class LogStore {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async appendMutation(record: MutationRecord): Promise<void> {
    const logPath = await this.getMutationLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  public async listMutations(): Promise<MutationRecord[]> {
    const logPath = await this.getMutationLogPath();
    let raw: string;
    try {
      raw = await fs.readFile(logPath, "utf8");
    } catch {
      return [];
    }

    const records: MutationRecord[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        records.push(JSON.parse(trimmed) as MutationRecord);
      } catch {
        // Skip malformed log lines and keep reading the rest.
      }
    }

    return records;
  }

  private async getMutationLogPath(): Promise<string> {
    return path.join(this.context.globalStorageUri.fsPath, LOG_DIR, MUTATION_LOG_FILE);
  }
}
