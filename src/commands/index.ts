import * as vscode from "vscode";
import { SessionBridgeService } from "../application/sessionBridgeService";
import type {
  MutationRecord,
  SessionArchiveFilter,
  SessionFilterState,
  SessionRecord,
  SessionTimeFilter
} from "../shared/types";
import { SessionsViewProvider } from "../ui/panelProvider";

function resolveSession(
  provider: SessionsViewProvider,
  input?: SessionRecord
): SessionRecord | undefined {
  return input ?? provider.getFirstSession();
}

export function registerCommands(
  context: vscode.ExtensionContext,
  provider: SessionsViewProvider,
  service: SessionBridgeService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.refreshSessions",
      async () => {
        await provider.refresh();
        await vscode.window.showInformationMessage(
          "Codex Session Bridge refreshed local sessions."
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.searchSessions",
      async () => {
        const query = await vscode.window.showInputBox({
          prompt: "Search local Codex sessions by id, title, cwd, provider, or path",
          value: provider.getSearchQuery(),
          placeHolder: "session id / title / cwd / provider"
        });

        if (query === undefined) {
          return;
        }

        provider.setSearchQuery(query);
        await vscode.window.showInformationMessage(
          query.trim().length > 0
            ? `Applied session search: ${query.trim()}`
            : "Session search cleared."
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.clearSessionSearch",
      async () => {
        provider.clearSearchQuery();
        await vscode.window.showInformationMessage("Session search cleared.");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.configureSessionFilters",
      async () => {
        const nextFilters = await promptForFilters(provider);
        if (!nextFilters) {
          return;
        }

        provider.updateFilters(nextFilters);
        const summary = provider.getFilterSummary();
        await vscode.window.showInformationMessage(
          summary ? `Applied session filters: ${summary}` : "Session filters cleared."
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.clearSessionFilters",
      async () => {
        provider.clearFilters();
        await vscode.window.showInformationMessage("Session filters cleared.");
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.previewSession",
      async (input?: SessionRecord) => {
        const target = resolveSession(provider, input);
        if (!target) {
          await vscode.window.showWarningMessage(
            "No session is available for preview."
          );
          return;
        }

        const markdown = await service.buildSessionPreview(target);
        const document = await vscode.workspace.openTextDocument({
          language: "markdown",
          content: markdown
        });

        await vscode.window.showTextDocument(document, {
          preview: false,
          preserveFocus: false
        });
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.restoreSession",
      async (input?: SessionRecord) => {
        const target = resolveSession(provider, input);
        if (!target) {
          await vscode.window.showWarningMessage(
            "No local session is available to open."
          );
          return;
        }

        try {
          const opened = await service.openSessionInCodex(target);
          if (opened) {
            await vscode.window.showInformationMessage(
              `Opened local Codex thread: ${target.title ?? target.id}`
            );
            return;
          }

          await vscode.window.showWarningMessage(
            `VS Code did not confirm opening the local Codex thread: ${target.title ?? target.id}`
          );
          return;
        } catch (error) {
          await vscode.window.showWarningMessage(
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.experimentalSyncVisibility",
      async (input?: SessionRecord) => {
        const target = resolveSession(provider, input);
        if (!target) {
          await vscode.window.showWarningMessage(
            "No session is available for visibility sync."
          );
          return;
        }

        const confirmation = await vscode.window.showWarningMessage(
          `Experimental sync will modify local Codex state for session: ${target.title ?? target.id}`,
          { modal: true, detail: "A backup will be created before any write." },
          "Continue"
        );
        if (confirmation !== "Continue") {
          return;
        }

        const mutation = await service.syncSessionVisibility(context, target);
        await provider.refresh();
        await vscode.window.showInformationMessage(
          `Visibility sync completed. Backup ID: ${mutation.backupId}`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.rollbackLastMutation",
      async () => {
        const rollback = await service.rollbackLastMutation(context);
        if (!rollback) {
          await vscode.window.showWarningMessage(
            "No rollback record is available."
          );
          return;
        }

        await provider.refresh();
        await vscode.window.showInformationMessage(
          `Rollback completed for backup: ${rollback.backupId}`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.rollbackSpecificMutation",
      async () => {
        const candidates = await service.listRollbackCandidates(context);
        const target = await promptForRollbackCandidate(candidates);
        if (!target) {
          return;
        }

        const confirmation = await vscode.window.showWarningMessage(
          `Rollback mutation ${target.id}?`,
          {
            modal: true,
            detail:
              "The current local state will be backed up before files are restored."
          },
          "Rollback"
        );
        if (confirmation !== "Rollback") {
          return;
        }

        const rollback = await service.rollbackMutation(context, target.id);
        await provider.refresh();
        await vscode.window.showInformationMessage(
          `Rollback completed for mutation: ${target.id}`
        );
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "codexSessionBridge.viewMutationHistory",
      async () => {
        const markdown = await service.buildMutationHistoryMarkdown(context);
        const document = await vscode.workspace.openTextDocument({
          language: "markdown",
          content: markdown
        });

        await vscode.window.showTextDocument(document, {
          preview: false,
          preserveFocus: false
        });
      }
    )
  );
}

async function promptForFilters(
  provider: SessionsViewProvider
): Promise<Partial<SessionFilterState> | null> {
  const current = provider.getFilterState();
  const options = provider.getFilterOptions();

  const providerValue = await promptForProviderFilter(
    options.providers,
    current.provider
  );
  if (providerValue === undefined) {
    return null;
  }

  const cwdValue = await promptForCwdFilter(options.cwdValues, current.cwd);
  if (cwdValue === undefined) {
    return null;
  }

  const archivedValue = await promptForArchiveFilter(current.archived);
  if (archivedValue === undefined) {
    return null;
  }

  const timeWindowValue = await promptForTimeFilter(current.timeWindow);
  if (timeWindowValue === undefined) {
    return null;
  }

  return {
    provider: providerValue,
    cwd: cwdValue,
    archived: archivedValue,
    timeWindow: timeWindowValue
  };
}

async function promptForProviderFilter(
  providers: string[],
  currentValue: string | null
): Promise<string | null | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Any provider",
        value: null,
        description: currentValue === null ? "current" : undefined
      },
      ...providers.map((provider) => ({
        label: provider,
        value: provider,
        description: currentValue === provider ? "current" : undefined
      }))
    ],
    {
      title: "Filter sessions by provider",
      placeHolder: "Choose a provider filter"
    }
  );

  return pick?.value;
}

async function promptForCwdFilter(
  cwdValues: string[],
  currentValue: string | null
): Promise<string | null | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Any working directory",
        value: null,
        description: currentValue === null ? "current" : undefined
      },
      ...cwdValues.map((cwd) => ({
        label: pathBaseName(cwd),
        value: cwd,
        description: buildCwdDescription(cwd, currentValue)
      }))
    ],
    {
      title: "Filter sessions by working directory",
      placeHolder: "Choose a working directory filter",
      matchOnDescription: true
    }
  );

  return pick?.value;
}

async function promptForArchiveFilter(
  currentValue: SessionArchiveFilter
): Promise<SessionArchiveFilter | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "All sessions",
        value: "all" as const,
        description: currentValue === "all" ? "current" : undefined
      },
      {
        label: "Active only",
        value: "active" as const,
        description: currentValue === "active" ? "current" : undefined
      },
      {
        label: "Archived only",
        value: "archived" as const,
        description: currentValue === "archived" ? "current" : undefined
      }
    ],
    {
      title: "Filter sessions by archive state",
      placeHolder: "Choose an archive filter"
    }
  );

  return pick?.value;
}

async function promptForTimeFilter(
  currentValue: SessionTimeFilter
): Promise<SessionTimeFilter | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Any time",
        value: "all" as const,
        description: currentValue === "all" ? "current" : undefined
      },
      {
        label: "Last 7 days",
        value: "7d" as const,
        description: currentValue === "7d" ? "current" : undefined
      },
      {
        label: "Last 30 days",
        value: "30d" as const,
        description: currentValue === "30d" ? "current" : undefined
      },
      {
        label: "Last 90 days",
        value: "90d" as const,
        description: currentValue === "90d" ? "current" : undefined
      }
    ],
    {
      title: "Filter sessions by update time",
      placeHolder: "Choose a time filter"
    }
  );

  return pick?.value;
}

async function promptForRollbackCandidate(
  candidates: MutationRecord[]
): Promise<MutationRecord | undefined> {
  if (!candidates.length) {
    await vscode.window.showWarningMessage(
      "No completed mutation with rollback support is available."
    );
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: candidate.id,
      description: new Date(candidate.createdAt).toLocaleString(),
      detail: candidate.notes ?? candidate.affectedSessionIds.join(", "),
      value: candidate
    })),
    {
      title: "Choose a mutation to rollback",
      placeHolder: "Only completed provider sync mutations are listed",
      matchOnDescription: true,
      matchOnDetail: true
    }
  );

  return pick?.value;
}

function pathBaseName(filePath: string): string {
  const trimmed = filePath.replace(/[\\\/]+$/, "");
  const segments = trimmed.split(/[\\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
}

function buildCwdDescription(
  cwd: string,
  currentValue: string | null
): string | undefined {
  const parts = [cwd];
  if (currentValue === cwd) {
    parts.unshift("current");
  }
  return parts.join(" | ");
}
