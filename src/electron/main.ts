import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const errorLogPath = path.join(os.homedir(), ".oro", "electron.log");
function logMessage(msg: string) {
  try {
    fs.appendFileSync(errorLogPath, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

process.on("uncaughtException", (err) => {
  logMessage(`UncaughtException: ${err?.stack || err}`);
});
process.on("unhandledRejection", (err) => {
  logMessage(`UnhandledRejection: ${err}`);
});

// Ensure dedicated userData directory in ~/.oro/electron-data to prevent cache conflicts
try {
  app.setPath("userData", path.join(os.homedir(), ".oro", "electron-data"));
} catch {}

let mainWindow: BrowserWindow | null = null;
let serverChild: ChildProcess | null = null;

function checkUrlReady(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url: string, maxAttempts = 50): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const ready = await checkUrlReady(url);
    if (ready) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function getLatestWorkspace(explicitDir?: string): string {
  if (explicitDir) {
    try {
      if (fs.existsSync(explicitDir) && fs.statSync(explicitDir).isDirectory()) {
        const resolved = path.resolve(explicitDir);
        logMessage(`Using explicit workspace from CLI args: ${resolved}`);
        return resolved;
      }
    } catch {}
  }

  // Look up the most recent workspace from ~/.oro/recent.json (Oro standard) and recent-workspaces.json
  const candidateFiles = [
    path.join(os.homedir(), ".oro", "recent.json"),
    path.join(os.homedir(), ".oro", "recent-workspaces.json"),
  ];

  for (const recentsPath of candidateFiles) {
    try {
      if (fs.existsSync(recentsPath)) {
        const content = fs.readFileSync(recentsPath, "utf8");
        const list = JSON.parse(content);
        if (Array.isArray(list) && list.length > 0) {
          for (const item of list) {
            const p = item?.path;
            if (p && typeof p === "string" && fs.existsSync(p)) {
              const stat = fs.statSync(p);
              if (stat.isDirectory()) {
                const resolved = path.resolve(p);
                logMessage(`Resolved latest used workspace from ${recentsPath}: ${resolved}`);
                return resolved;
              }
            }
          }
        }
      }
    } catch (err) {
      logMessage(`Error reading ${recentsPath}: ${err}`);
    }
  }

  // Fallback to default OroBrain
  const fallback = path.join(os.homedir(), "OroBrain");
  logMessage(`No recent workspace found, falling back to default: ${fallback}`);
  return fallback;
}

async function ensureServerRunning(preferredPort = 5824, workspaceDir?: string): Promise<string> {
  const checkUrl = `http://127.0.0.1:${preferredPort}/api/workspace`;
  const isAlreadyRunning = await checkUrlReady(checkUrl);
  const targetDir = getLatestWorkspace(workspaceDir);
  logMessage(`ensureServerRunning: targetDir=${targetDir}, isAlreadyRunning=${isAlreadyRunning}`);

  if (isAlreadyRunning) {
    // Terminate any stale background server to guarantee the latest code runs
    try {
      await new Promise<void>((resolve) => {
        const shutdownReq = http.request(
          `http://127.0.0.1:${preferredPort}/api/server/shutdown`,
          { method: "POST" },
          () => resolve()
        );
        shutdownReq.on("error", () => resolve());
        shutdownReq.setTimeout(800, () => {
          shutdownReq.destroy();
          resolve();
        });
        shutdownReq.end();
      });

      // Wait briefly for port to be released
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const stillUp = await checkUrlReady(checkUrl);
        if (!stillUp) break;
      }
    } catch (err) {
      logMessage(`Error shutting down stale server: ${err}`);
    }
  }

  // Spawn backend server via host node (Node 26+)
  const serverScript = path.resolve(__dirname, "../server/run-server.js");
  const nodeArgs = [serverScript, targetDir, String(preferredPort)];
  const nodeExe = fs.existsSync("C:\\Program Files\\nodejs\\node.exe")
    ? "C:\\Program Files\\nodejs\\node.exe"
    : "node";

  const oroDir = path.join(os.homedir(), ".oro");
  try {
    fs.mkdirSync(oroDir, { recursive: true });
  } catch {}
  const logPath = path.join(oroDir, "server.log");
  const logStream = fs.createWriteStream(logPath, { flags: "a" });

  serverChild = spawn(nodeExe, nodeArgs, {
    cwd: path.resolve(__dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  serverChild.stdout?.pipe(logStream);
  serverChild.stderr?.pipe(logStream);

  serverChild.on("error", (err) => {
    logMessage(`serverChild spawn error: ${err?.stack || err}`);
  });

  serverChild.on("exit", (code, signal) => {
    logMessage(`serverChild process exited with code=${code} signal=${signal}`);
  });

  const ready = await waitForServer(checkUrl, 50);
  if (!ready) {
    console.warn("Server did not respond within timeout, attempting load anyway…");
  }

  return `http://127.0.0.1:${preferredPort}`;
}

async function createWindow(serverUrl: string): Promise<void> {
  const iconPng = path.resolve(__dirname, "../../resources/icon.png");
  const iconIco = path.resolve(__dirname, "../../resources/icon.ico");
  const chosenIcon = (process.platform === "win32" && fs.existsSync(iconIco)) ? iconIco : iconPng;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 640,
    minHeight: 450,
    title: "Oro — AI Second Brain",
    icon: fs.existsSync(chosenIcon) ? chosenIcon : undefined,
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (fs.existsSync(chosenIcon)) {
    mainWindow.setIcon(chosenIcon);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("console-message", (_evt, level, message, line, sourceId) => {
    logMessage(`[Console L${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("did-fail-load", (_evt, errorCode, errorDescription, validatedURL) => {
    logMessage(`did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });

  mainWindow.webContents.on("render-process-gone", (_evt, details) => {
    logMessage(`render-process-gone: ${JSON.stringify(details)}`);
  });

  logMessage(`Loading URL: ${serverUrl}`);
  try {
    // Clear Chromium cache so fresh web bundles are always used
    await mainWindow.webContents.session.clearCache();
    await mainWindow.loadURL(serverUrl);
    logMessage("Successfully loaded URL");
  } catch (loadErr) {
    logMessage(`loadURL error: ${loadErr}`);
  }

  mainWindow.on("closed", () => {
    logMessage("mainWindow closed event fired");
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle("oro:selectWorkspaceFolder", async () => {
    if (!mainWindow) return null;
    const res = await dialog.showOpenDialog(mainWindow, {
      title: "Select Second Brain or Project Folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0]!;
  });

  ipcMain.handle("oro:windowControl", (_evt, action: "minimize" | "maximize" | "close") => {
    if (!mainWindow) return;
    if (action === "minimize") mainWindow.minimize();
    else if (action === "maximize") {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === "close") {
      mainWindow.close();
    }
  });

  ipcMain.handle("oro:revealInExplorer", (_evt, targetPath: string) => {
    if (targetPath) {
      shell.showItemInFolder(targetPath);
    }
  });
}

app.whenReady().then(async () => {
  if (process.platform === "win32") {
    app.setAppUserModelId("com.oro.assistant");
  }
  registerIpcHandlers();

  const args = process.argv.slice(1);
  const passedDir = args.find((a) => {
    if (!a) return false;
    if (a.startsWith("-") || a.startsWith("http")) return false;
    if (a.endsWith(".js") || a.endsWith(".cjs") || a.endsWith(".ts")) return false;
    if (a.toLowerCase().includes("electron")) return false;
    try {
      return fs.existsSync(a) && fs.statSync(a).isDirectory();
    } catch {
      return false;
    }
  });

  const targetUrl = await ensureServerRunning(5824, passedDir);

  await createWindow(targetUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(targetUrl);
    }
  });
});

app.on("before-quit", () => {
  logMessage("app before-quit fired");
  if (serverChild) {
    try {
      serverChild.kill();
    } catch {}
    serverChild = null;
  }
});

app.on("will-quit", () => {
  logMessage("app will-quit fired");
});

app.on("quit", (_evt, exitCode) => {
  logMessage(`app quit fired with exitCode=${exitCode}`);
});

app.on("window-all-closed", () => {
  logMessage("app window-all-closed fired");
  if (serverChild) {
    try {
      serverChild.kill();
    } catch {}
    serverChild = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
