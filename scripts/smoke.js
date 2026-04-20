const path = require("node:path");

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  const { SessionScanner } = require(path.join(
    projectRoot,
    "out",
    "discovery",
    "sessionScanner.js"
  ));
  const { VisibilitySync } = require(path.join(
    projectRoot,
    "out",
    "mutation",
    "visibilitySync.js"
  ));

  const scanner = new SessionScanner();
  const sessions = await scanner.scanSessions();

  if (!sessions.length) {
    throw new Error("Smoke test failed: no local Codex sessions were discovered.");
  }

  const providerCounts = new Map();
  for (const session of sessions) {
    const key = session.modelProvider || "null";
    providerCounts.set(key, (providerCounts.get(key) || 0) + 1);
  }

  const stateDbPath = path.join(process.env.USERPROFILE || "", ".codex", "state_5.sqlite");
  const visibilitySync = new VisibilitySync();
  const activeProvider = await visibilitySync.getMostRecentProvider(stateDbPath);

  let samplePlan = null;
  const candidate = sessions.find(
    (session) => activeProvider && session.modelProvider !== activeProvider
  );
  if (candidate && activeProvider) {
    samplePlan = await visibilitySync.buildPlan(
      candidate.id,
      candidate.sourcePath,
      activeProvider
    );
  }

  const summary = {
    sessionCount: sessions.length,
    latestSession: {
      id: sessions[0].id,
      title: sessions[0].title,
      provider: sessions[0].modelProvider,
      updatedAt: sessions[0].updatedAt
    },
    providers: Object.fromEntries([...providerCounts.entries()].sort()),
    activeProvider,
    samplePlan: samplePlan
      ? {
          sessionId: samplePlan.sessionId,
          sourceProvider: samplePlan.sourceProvider,
          targetProvider: samplePlan.targetProvider
        }
      : null
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
