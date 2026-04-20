import * as vscode from "vscode";
import {
  CODEX_COMMANDS,
  OFFICIAL_CODEX_EXTENSION_ID
} from "../shared/constants";
import { OfficialCodexHealth } from "./officialCodexHealth";

export class CodexCommands {
  private readonly officialCodexHealth = new OfficialCodexHealth();

  public async openLocalThread(sessionId: string): Promise<boolean> {
    const commands = new Set(await vscode.commands.getCommands(true));
    await this.officialCodexHealth.assertCanOpenLocalThread();

    if (commands.has(CODEX_COMMANDS.openSidebar)) {
      await vscode.commands.executeCommand(CODEX_COMMANDS.openSidebar);
    } else if (commands.has(CODEX_COMMANDS.newPanel)) {
      await vscode.commands.executeCommand(CODEX_COMMANDS.newPanel);
    }

    const routeUri = vscode.Uri.from({
      scheme: "vscode",
      authority: OFFICIAL_CODEX_EXTENSION_ID,
      path: `/local/${sessionId}`
    });

    return vscode.env.openExternal(routeUri);
  }
}
