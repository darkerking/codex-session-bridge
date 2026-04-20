import * as vscode from "vscode";
import {
  CODEX_COMMANDS,
  OFFICIAL_CODEX_EXTENSION_ID
} from "../shared/constants";

const OFFICIAL_CODEX_HEALTH_NOTICE_KEY =
  "codexSessionBridge.officialCodexHealthNotice";
const OPEN_EXTENSIONS_ACTION = "Open Extensions";
const REQUIRED_ACTIVATION_EVENT = "onUri";

export interface OfficialCodexHealthReport {
  extensionId: string;
  extensionVersion: string | null;
  isInstalled: boolean;
  isActive: boolean;
  hasOnUriActivation: boolean;
  hasSidebarCommand: boolean;
  hasNewPanelCommand: boolean;
  canOpenLocalThread: boolean;
  summary: string;
  issues: string[];
}

export class OfficialCodexHealth {
  public async inspect(): Promise<OfficialCodexHealthReport> {
    const commands = new Set(await vscode.commands.getCommands(true));
    const extension = vscode.extensions.getExtension(OFFICIAL_CODEX_EXTENSION_ID);
    const extensionVersion = extension?.packageJSON?.version
      ? String(extension.packageJSON.version)
      : null;
    const activationEvents = Array.isArray(extension?.packageJSON?.activationEvents)
      ? extension?.packageJSON?.activationEvents
      : [];
    const hasOnUriActivation = activationEvents.includes(REQUIRED_ACTIVATION_EVENT);
    const hasSidebarCommand = commands.has(CODEX_COMMANDS.openSidebar);
    const hasNewPanelCommand = commands.has(CODEX_COMMANDS.newPanel);
    const isInstalled = Boolean(extension);
    const issues: string[] = [];

    if (!isInstalled) {
      issues.push("OpenAI ChatGPT extension is not installed or enabled.");
    } else if (!hasOnUriActivation) {
      issues.push(
        "The installed OpenAI ChatGPT extension does not expose the onUri activation required for local-thread reopening."
      );
    }

    const canOpenLocalThread = isInstalled && hasOnUriActivation;
    const summary = this.buildSummary({
      extensionVersion,
      isInstalled,
      hasOnUriActivation,
      hasSidebarCommand,
      hasNewPanelCommand,
      issues
    });

    return {
      extensionId: OFFICIAL_CODEX_EXTENSION_ID,
      extensionVersion,
      isInstalled,
      isActive: extension?.isActive ?? false,
      hasOnUriActivation,
      hasSidebarCommand,
      hasNewPanelCommand,
      canOpenLocalThread,
      summary,
      issues
    };
  }

  public async assertCanOpenLocalThread(): Promise<OfficialCodexHealthReport> {
    const report = await this.inspect();
    if (!report.canOpenLocalThread) {
      throw new Error(report.summary);
    }

    return report;
  }

  public async notifyIfNeeded(
    context: vscode.ExtensionContext
  ): Promise<OfficialCodexHealthReport> {
    const report = await this.inspect();
    if (report.canOpenLocalThread) {
      await context.globalState.update(OFFICIAL_CODEX_HEALTH_NOTICE_KEY, undefined);
      return report;
    }

    const fingerprint = this.buildNoticeFingerprint(report);
    const previousFingerprint = context.globalState.get<string>(
      OFFICIAL_CODEX_HEALTH_NOTICE_KEY
    );

    if (previousFingerprint === fingerprint) {
      return report;
    }

    await context.globalState.update(
      OFFICIAL_CODEX_HEALTH_NOTICE_KEY,
      fingerprint
    );

    const choice = await vscode.window.showWarningMessage(
      report.summary,
      OPEN_EXTENSIONS_ACTION
    );

    if (choice === OPEN_EXTENSIONS_ACTION) {
      await vscode.commands.executeCommand(
        "workbench.extensions.search",
        `@id:${OFFICIAL_CODEX_EXTENSION_ID}`
      );
    }

    return report;
  }

  private buildNoticeFingerprint(report: OfficialCodexHealthReport): string {
    return [
      report.extensionVersion ?? "missing",
      String(report.isInstalled),
      String(report.hasOnUriActivation)
    ].join(":");
  }

  private buildSummary(input: {
    extensionVersion: string | null;
    isInstalled: boolean;
    hasOnUriActivation: boolean;
    hasSidebarCommand: boolean;
    hasNewPanelCommand: boolean;
    issues: string[];
  }): string {
    if (!input.isInstalled) {
      return "Open in Codex needs the OpenAI ChatGPT extension (`openai.chatgpt`). Install or enable it, then try again.";
    }

    if (!input.hasOnUriActivation) {
      const versionLabel = input.extensionVersion
        ? ` v${input.extensionVersion}`
        : "";
      return `Detected OpenAI ChatGPT${versionLabel}, but it does not expose the URI handler required for native local-thread reopening. Update the extension and try again.`;
    }

    if (!input.hasSidebarCommand && !input.hasNewPanelCommand) {
      const versionLabel = input.extensionVersion
        ? ` v${input.extensionVersion}`
        : "";
      return `OpenAI ChatGPT${versionLabel} passed the URI check. Session Bridge will open local threads through the URI handler directly.`;
    }

    return "OpenAI ChatGPT is ready for native local-thread reopening.";
  }
}
