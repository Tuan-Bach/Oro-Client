import path from "node:path";
import fs from "node:fs";
import { startOroServer } from "./server.js";
import { getDefaultBrainPath, loadRecentWorkspaces } from "../config/config.js";

async function main() {
  const args = process.argv.slice(2);
  let workspaceDir: string | undefined;
  let port = 5824;

  if (args[0]) {
    if (/^\d+$/.test(args[0])) {
      port = parseInt(args[0], 10);
    } else {
      workspaceDir = path.resolve(args[0]);
      if (args[1] && /^\d+$/.test(args[1])) {
        port = parseInt(args[1], 10);
      }
    }
  }

  if (!workspaceDir) {
    try {
      const recents = loadRecentWorkspaces();
      if (recents.length > 0 && recents[0]?.path && fs.existsSync(recents[0].path)) {
        workspaceDir = path.resolve(recents[0].path);
      }
    } catch {}
  }

  if (!workspaceDir) {
    workspaceDir = getDefaultBrainPath();
  }

  const instance = await startOroServer(workspaceDir, port);
  console.log(`✦ Oro server running at ${instance.url} (workspace: ${instance.workspaceRoot})`);

  const shutdown = async () => {
    console.log("Shutting down Oro server…");
    await instance.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Oro server failed to start:", err);
  process.exit(1);
});
