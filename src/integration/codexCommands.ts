import * as vscode from "vscode";
import { CODEX_COMMANDS } from "../shared/constants";

export class CodexCommands {
  public async restoreRecoveryFile(markdownPath: string): Promise<boolean> {
    const commands = new Set(await vscode.commands.getCommands(true));
    const fileUri = vscode.Uri.file(markdownPath);

    if (commands.has(CODEX_COMMANDS.openSidebar)) {
      await vscode.commands.executeCommand(CODEX_COMMANDS.openSidebar);
    } else if (commands.has(CODEX_COMMANDS.newPanel)) {
      await vscode.commands.executeCommand(CODEX_COMMANDS.newPanel);
    }

    await vscode.window.showTextDocument(fileUri, {
      preview: false,
      preserveFocus: true
    });

    if (!commands.has(CODEX_COMMANDS.addFileToThread)) {
      return false;
    }

    try {
      await vscode.commands.executeCommand(
        CODEX_COMMANDS.addFileToThread,
        fileUri
      );
      return true;
    } catch {
      try {
        await vscode.commands.executeCommand(CODEX_COMMANDS.addFileToThread);
        return true;
      } catch {
        return false;
      }
    }
  }
}
