import * as vscode from "vscode";
import { SessionBridgeService } from "./application/sessionBridgeService";
import { registerCommands } from "./commands";
import { SessionsViewProvider } from "./ui/panelProvider";

export function activate(context: vscode.ExtensionContext): void {
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
}

export function deactivate(): void {
  // Reserved for future cleanup hooks such as watchers and caches.
}
