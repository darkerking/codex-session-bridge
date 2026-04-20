import * as vscode from "vscode";
import { SessionBridgeService } from "./application/sessionBridgeService";
import { registerCommands } from "./commands";
import { OfficialCodexHealth } from "./integration/officialCodexHealth";
import { SessionsViewProvider } from "./ui/panelProvider";

export function activate(context: vscode.ExtensionContext): void {
  const officialCodexHealth = new OfficialCodexHealth();
  const sessionBridgeService = new SessionBridgeService();
  const sessionsViewProvider = new SessionsViewProvider(
    context.extensionUri,
    sessionBridgeService
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "codexSessionBridge.sessionsView",
      sessionsViewProvider
    )
  );

  registerCommands(context, sessionsViewProvider, sessionBridgeService);
  void sessionsViewProvider.refresh();
  void officialCodexHealth.notifyIfNeeded(context);
}

export function deactivate(): void {
  // Reserved for future cleanup hooks such as watchers and caches.
}
