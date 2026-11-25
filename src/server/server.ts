import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentTurn } from "../agent/engine.js";
import { runAutonomousOrchestrator, runTriadOrchestrator } from "../agent/orchestrator.js";
import { classifyIntent } from "../agent/modes.js";
import { summarizeAndDistillSession } from "../agent/summarizer.js";
import { isDefaultSessionTitle, generateShortSessionTitle } from "../agent/session-naming.js";
import {
  getDefaultBrainPath,
  getWorkspaceOroDir,
  loadConfig,
  loadRecentWorkspaces,
  openInExternalEditor,
  revealInExplorer,
  recordRecentWorkspace,
  saveProviderKey,
  saveProviderModel,
  saveGlobalConfig,
  saveDefaultBrainPath,
  fetchOllamaModels,
  fetchProviderModels,
} from "../config/config.js";
import { OroStore } from "../db/store.js";
import { createProvider } from "../providers/factory.js";
import type { AgentModeId, ProviderId, ToolCallEvent } from "../types.js";
import { VaultFsManager } from "../vault/fs-manager.js";
import { VaultIndexer } from "../vault/indexer.js";
import { VaultSnapshotManager } from "../vault/snapshot-manager.js";
import { initStarterVault } from "../vault/starter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ServerInstance {
  server: http.Server;
  port: number;
  url: string;
  workspaceRoot: string;
  close: () => Promise<void>;
  switchWorkspace: (targetDir: string) => void;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function startOroServer(initialDir: string, preferredPort = 5824): Promise<ServerInstance> {
  return new Promise((resolve, reject) => {
    let currentWorkspaceRoot = path.resolve(initialDir);
    let currentStore: OroStore;
    let currentIndexer: VaultIndexer;
    let currentFsManager: VaultFsManager;
    let currentSnapshotManager: VaultSnapshotManager;

    function initWorkspace(dir: string, seedStarter = false) {
      let abs = path.resolve(dir);
      try {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          abs = path.dirname(abs);
        }
      } catch {}
      const existed = fs.existsSync(abs);
      fs.mkdirSync(abs, { recursive: true });
      if (seedStarter && (!existed || fs.readdirSync(abs).filter((f) => f !== ".oro").length === 0)) {
        initStarterVault(abs);
      }

      if (currentIndexer) currentIndexer.stopWatching();
      if (currentStore) currentStore.close();

      const oroDir = getWorkspaceOroDir(abs);
      fs.mkdirSync(oroDir, { recursive: true });
      const dbPath = path.join(oroDir, "oro.db");

      currentWorkspaceRoot = abs;
      currentStore = new OroStore(dbPath);
      currentIndexer = new VaultIndexer(abs, currentStore);
      currentFsManager = new VaultFsManager(abs, currentStore, currentIndexer);
      currentSnapshotManager = new VaultSnapshotManager(abs, currentStore, currentFsManager, currentIndexer);

      const cfg = loadConfig(abs);
      if (cfg.autoIndex) {
        setImmediate(() => {
          try {
            currentIndexer?.indexAll(false);
          } catch (err) {
            console.error("Auto-index background error:", err);
          }
        });
      }
      currentIndexer.startWatching();
      recordRecentWorkspace(abs);
    }

    initWorkspace(initialDir);

    const distRendererDir = path.resolve(__dirname, "../renderer");

    const server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url ?? "/", `http://localhost:${preferredPort}`);
      const pathname = parsedUrl.pathname;

      // Helper to parse JSON body
      const readJsonBody = async <T>(): Promise<T> => {
        return new Promise((resBody, rejBody) => {
          let data = "";
          req.on("data", (chunk) => (data += chunk));
          req.on("end", () => {
            try {
              resBody(data ? (JSON.parse(data) as T) : ({} as T));
            } catch (err) {
              rejBody(err);
            }
          });
          req.on("error", rejBody);
        });
      };

      const sendJson = (statusCode: number, data: unknown) => {
        res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
      };

      try {
        // ==================== API ROUTES ====================
        if (pathname === "/api/workspace" && req.method === "GET") {
          sendJson(200, {
            root: currentWorkspaceRoot,
            name: path.basename(currentWorkspaceRoot),
            stats: currentStore.getVaultStats(),
          });
          return;
        }

        if (pathname === "/api/workspace/switch" && req.method === "POST") {
          const body = await readJsonBody<{ folderPath: string; seedStarter?: boolean }>();
          if (!body.folderPath) {
            sendJson(400, { error: "folderPath is required" });
            return;
          }
          initWorkspace(body.folderPath, !!body.seedStarter);
          sendJson(200, {
            root: currentWorkspaceRoot,
            name: path.basename(currentWorkspaceRoot),
            stats: currentStore.getVaultStats(),
          });
          return;
        }

        if (pathname === "/api/workspace/reindex" && req.method === "POST") {
          const res = currentIndexer.indexAll(true);
          sendJson(200, {
            ...res,
            stats: currentStore.getVaultStats(),
          });
          return;
        }

        if (pathname === "/api/workspace/recents" && req.method === "GET") {
          sendJson(200, loadRecentWorkspaces());
          return;
        }

        if (pathname === "/api/tree" && req.method === "GET") {
          const subPath = parsedUrl.searchParams.get("subPath") || "";
          sendJson(200, currentFsManager.buildTree(subPath, 5));
          return;
        }

        if (pathname === "/api/file" && req.method === "GET") {
          const relPath = parsedUrl.searchParams.get("path");
          if (!relPath) {
            sendJson(400, { error: "path is required" });
            return;
          }
          sendJson(200, currentFsManager.readFile(relPath));
          return;
        }

        if (pathname === "/api/file" && req.method === "POST") {
          const body = await readJsonBody<{ path: string; content: string; encoding?: "utf8" | "base64" }>();
          sendJson(200, currentFsManager.writeFile(body.path, body.content, undefined, body.encoding));
          return;
        }

        if (pathname === "/api/file" && req.method === "DELETE") {
          const body = await readJsonBody<{ path: string }>();
          sendJson(200, currentFsManager.deletePath(body.path));
          return;
        }

        if (pathname === "/api/file/move" && req.method === "POST") {
          const body = await readJsonBody<{ from: string; to: string }>();
          sendJson(200, currentFsManager.movePath(body.from, body.to));
          return;
        }

        if (pathname === "/api/folder" && req.method === "POST") {
          const body = await readJsonBody<{ path: string }>();
          sendJson(200, currentFsManager.createFolder(body.path));
          return;
        }

        if (pathname === "/api/open-external" && req.method === "POST") {
          const body = await readJsonBody<{ path?: string }>();
          const relPath = body.path || "";
          const targetAbs = relPath ? currentFsManager.resolveSafe(relPath).abs : currentWorkspaceRoot;
          sendJson(200, { opener: openInExternalEditor(targetAbs) });
          return;
        }

        if (pathname === "/api/reveal-in-explorer" && req.method === "POST") {
          const body = await readJsonBody<{ path?: string }>();
          const relPath = body.path || "";
          const targetAbs = relPath ? currentFsManager.resolveSafe(relPath).abs : currentWorkspaceRoot;
          revealInExplorer(targetAbs);
          sendJson(200, { success: true, path: targetAbs });
          return;
        }

        if (pathname === "/api/backlinks" && req.method === "GET") {
          const relPath = parsedUrl.searchParams.get("path") || "";
          const outgoing = currentStore.getOutgoingLinks(relPath);
          const backlinks = currentStore.getBacklinks(relPath);
          const tags = currentStore.getTagsForNote(relPath);
          sendJson(200, { outgoing, backlinks, tags });
          return;
        }

        if (pathname === "/api/links" && req.method === "GET") {
          sendJson(200, currentStore.getAllLinks());
          return;
        }

        if (pathname === "/api/search" && req.method === "GET") {
          const query = parsedUrl.searchParams.get("q") || "";
          sendJson(200, currentStore.searchNotes(query, 25));
          return;
        }

        if (pathname === "/api/sessions" && req.method === "GET") {
          const cfg = loadConfig(currentWorkspaceRoot);
          const list = currentStore.listSessions(30);
          if (list.length === 0) {
            const created = currentStore.createSession({
              title: "Main Workspace",
              mode: cfg.defaultMode,
              provider: cfg.provider,
              model: cfg.providers[cfg.provider].model,
            });
            sendJson(200, [created]);
            return;
          }
          sendJson(200, list);
          return;
        }

        if (pathname === "/api/sessions" && req.method === "POST") {
          const body = await readJsonBody<{ title?: string; mode?: AgentModeId }>();
          const cfg = loadConfig(currentWorkspaceRoot);
          const created = currentStore.createSession({
            title: body.title,
            mode: body.mode ?? cfg.defaultMode,
            provider: cfg.provider,
            model: cfg.providers[cfg.provider].model,
          });
          sendJson(200, created);
          return;
        }

        if (pathname === "/api/session" && req.method === "GET") {
          const id = parsedUrl.searchParams.get("id");
          if (!id) {
            sendJson(400, { error: "id required" });
            return;
          }
          sendJson(200, currentStore.getSession(id));
          return;
        }

        if (pathname === "/api/session/update" && req.method === "POST") {
          const body = await readJsonBody<{ id: string; patch: Record<string, unknown> }>();
          currentStore.updateSession(body.id, body.patch as Parameters<OroStore["updateSession"]>[1]);
          sendJson(200, { ok: true });
          return;
        }

        if (pathname === "/api/session/delete" && req.method === "POST") {
          const body = await readJsonBody<{ id: string }>();
          currentStore.deleteSession(body.id);
          sendJson(200, { ok: true });
          return;
        }

        if (pathname === "/api/dialog/open-folder" && req.method === "POST") {
          let selectedPath: string | null = null;
          if (process.platform === "win32") {
            try {
              const { execSync } = await import("node:child_process");
              const psCmd = `powershell.exe -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Workspace / Second Brain Folder'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"`;
              const out = execSync(psCmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000 }).trim();
              if (out) selectedPath = out;
            } catch {}
          }
          sendJson(200, { folderPath: selectedPath });
          return;
        }

        if (pathname === "/api/session-files" && req.method === "GET") {
          const sessionId = parsedUrl.searchParams.get("sessionId");
          if (!sessionId) {
            sendJson(400, { error: "sessionId required" });
            return;
          }
          sendJson(200, currentStore.getSessionFiles(sessionId));
          return;
        }

        if (pathname === "/api/session-files/pin" && req.method === "POST") {
          const body = await readJsonBody<{ sessionId: string; path: string; pinned: boolean }>();
          currentStore.setFilePinned(body.sessionId, body.path, body.pinned);
          sendJson(200, { ok: true });
          return;
        }

        if (pathname === "/api/memories" && req.method === "GET") {
          const q = parsedUrl.searchParams.get("q") || undefined;
          sendJson(200, q ? currentStore.searchMemories(q, 20) : currentStore.listMemories(20));
          return;
        }

        if (pathname === "/api/memories" && req.method === "POST") {
          const body = await readJsonBody<{ content: string; category?: string }>();
          sendJson(
            200,
            currentStore.saveMemory({
              content: body.content,
              category: (body.category as "fact") ?? "fact",
              importance: 4,
            })
          );
          return;
        }

        if (pathname === "/api/tasks" && req.method === "GET") {
          sendJson(200, currentStore.listTasks(true, 50));
          return;
        }

        if (pathname === "/api/tasks/toggle" && req.method === "POST") {
          const body = await readJsonBody<{ id: number; done?: boolean }>();
          sendJson(200, currentStore.toggleTask(body.id, body.done));
          return;
        }

        if (pathname === "/api/tasks" && req.method === "POST") {
          const body = await readJsonBody<{ title: string; filePath?: string }>();
          sendJson(200, currentStore.addTask({ title: body.title, filePath: body.filePath }));
          return;
        }

        if (pathname === "/api/config" && req.method === "GET") {
          sendJson(200, loadConfig(currentWorkspaceRoot));
          return;
        }

        if (pathname === "/api/config" && req.method === "POST") {
          const body = await readJsonBody<Record<string, unknown>>();
          saveGlobalConfig(body);
          sendJson(200, loadConfig(currentWorkspaceRoot));
          return;
        }

        if (pathname === "/api/config/brain" && req.method === "POST") {
          const body = await readJsonBody<{ path: string }>();
          if (body.path) {
            saveDefaultBrainPath(body.path);
          }
          sendJson(200, { ok: true, defaultVaultPath: getDefaultBrainPath() });
          return;
        }

        if (pathname === "/api/ollama/models" && req.method === "GET") {
          const baseUrl = parsedUrl.searchParams.get("baseUrl") || "http://localhost:11434";
          const list = await fetchOllamaModels(baseUrl);
          sendJson(200, list);
          return;
        }

        if (pathname === "/api/provider/models" && req.method === "POST") {
          const body = await readJsonBody<{ provider: ProviderId; apiKey?: string; baseUrl?: string }>();
          const cfg = loadConfig(currentWorkspaceRoot);
          const effectiveKey =
            body.apiKey?.trim() ||
            cfg.providers[body.provider]?.apiKey ||
            process.env[`${body.provider.toUpperCase()}_API_KEY`];
          const effectiveBaseUrl = body.baseUrl || cfg.providers[body.provider]?.baseUrl;
          const list = await fetchProviderModels(body.provider, effectiveKey, effectiveBaseUrl);
          sendJson(200, list);
          return;
        }

        if (pathname === "/api/config/key" && req.method === "POST") {
          const body = await readJsonBody<{ provider: ProviderId; apiKey: string }>();
          saveProviderKey(body.provider, body.apiKey);
          sendJson(200, { ok: true });
          return;
        }

        if (pathname === "/api/config/model" && req.method === "POST") {
          const body = await readJsonBody<{
            provider: ProviderId;
            model: string;
            baseUrl?: string;
            reasoningEffort?: "low" | "medium" | "high";
          }>();
          saveProviderModel(body.provider, body.model, body.baseUrl, body.reasoningEffort);
          sendJson(200, { ok: true });
          return;
        }

        // SSE Streaming Chat Endpoint
        if (pathname === "/api/chat" && req.method === "POST") {
          const body = await readJsonBody<{ sessionId: string; mode: AgentModeId; prompt: string }>();
          const session = currentStore.getSession(body.sessionId);
          if (!session) {
            sendJson(404, { error: "Session not found" });
            return;
          }

          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          const sendEvent = (payload: unknown) => {
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          };

          const cfg = loadConfig(currentWorkspaceRoot);
          const provider = createProvider(cfg);
          const controller = new AbortController();

          req.on("close", () => {
            controller.abort();
          });

          try {
            // Auto-rename session to a punchy, short title if currently using a placeholder
            if (isDefaultSessionTitle(session.title)) {
              const shortTitle = generateShortSessionTitle(body.prompt);
              if (shortTitle) {
                currentStore.updateSession(session.id, { title: shortTitle });
                session.title = shortTitle;
                sendEvent({ type: "session_renamed", title: shortTitle });
              }
            }

            sendEvent({ type: "mode_decided", mode: "orchestrator" });

            // Zero-token per-turn workspace snapshot harness
            const activeTurn = currentSnapshotManager.beginTurn(session.id, body.prompt);
            currentFsManager.onBeforeMutation = (relPath, action, originalPath) => {
              currentSnapshotManager.recordBeforeMutation(activeTurn, relPath, action, originalPath);
            };

            await runAutonomousOrchestrator({
              userInput: body.prompt,
              session,
              provider,
              store: currentStore,
              fsManager: currentFsManager,
              maxSteps: cfg.maxAgentSteps,
              userInstructions: cfg.userInstructions,
              signal: controller.signal,
              callbacks: {
                onPhaseChange: (phase, detail) => {
                  sendEvent({ type: "phase_changed", phase, detail });
                },
                onVerification: (verification) => {
                  sendEvent({ type: "verification", verification });
                },
                onTextDelta: (delta) => {
                  sendEvent({ type: "text", textDelta: delta });
                },
                onToolEvent: (evt: ToolCallEvent) => {
                  if (evt.status === "running") {
                    sendEvent({
                      type: "tool_call",
                      toolCall: { id: evt.id, name: evt.name, args: evt.args },
                    });
                  } else {
                    sendEvent({
                      type: "tool_result",
                      toolResult: {
                        id: evt.id,
                        name: evt.name,
                        summary: evt.summary ?? "",
                        ok: evt.status === "done",
                      },
                    });
                  }
                },
                onVaultMutated: () => {
                  sendEvent({ type: "vault_mutated" });
                },
                onSubagentProgress: (subagentEvt) => {
                  sendEvent({ type: "subagent", subagent: subagentEvt });
                },
              },
            });

            currentFsManager.onBeforeMutation = undefined;
            const snapshotRecord = currentSnapshotManager.commitTurn(activeTurn);
            if (snapshotRecord) {
              sendEvent({ type: "snapshot", snapshot: snapshotRecord });
            }

            sendEvent({ type: "done" });
          } catch (err) {
            sendEvent({ type: "error", error: err instanceof Error ? err.message : String(err) });
          } finally {
            currentFsManager.onBeforeMutation = undefined;
            res.end();
          }
          return;
        }

        if (pathname === "/api/summarize" && req.method === "POST") {
          const body = await readJsonBody<{ sessionId: string }>();
          const session = currentStore.getSession(body.sessionId);
          if (!session) {
            sendJson(404, { error: "Session not found" });
            return;
          }
          const cfg = loadConfig(currentWorkspaceRoot);
          const provider = createProvider(cfg);
          const resSum = await summarizeAndDistillSession({
            session,
            provider,
            store: currentStore,
            fsManager: currentFsManager,
          });
          sendJson(200, resSum);
          return;
        }

        if (pathname === "/api/snapshots" && req.method === "GET") {
          const sessId = parsedUrl.searchParams.get("sessionId");
          if (!sessId) {
            sendJson(400, { error: "Missing sessionId parameter" });
            return;
          }
          const snapshots = currentSnapshotManager.listSnapshots(sessId);
          sendJson(200, snapshots);
          return;
        }

        if (pathname === "/api/snapshots/rollback" && req.method === "POST") {
          const body = await readJsonBody<{ snapshotId: string }>();
          if (!body.snapshotId) {
            sendJson(400, { error: "Missing snapshotId" });
            return;
          }
          const result = currentSnapshotManager.rollback(body.snapshotId);
          sendJson(200, result);
          return;
        }

        // ==================== EDITOR DRAFTS (CRASH RECOVERY) ====================
        if (pathname === "/api/drafts" && req.method === "GET") {
          const filePath = parsedUrl.searchParams.get("path");
          if (filePath) {
            sendJson(200, currentStore.getEditorDraft(filePath));
          } else {
            sendJson(200, currentStore.listEditorDrafts());
          }
          return;
        }

        if (pathname === "/api/drafts" && req.method === "POST") {
          const body = await readJsonBody<{ path: string; content: string }>();
          if (!body.path) {
            sendJson(400, { error: "Missing path" });
            return;
          }
          currentStore.saveEditorDraft(body.path, body.content ?? "");
          sendJson(200, { ok: true, path: body.path });
          return;
        }

        if (pathname === "/api/drafts" && req.method === "DELETE") {
          const body = await readJsonBody<{ path?: string; all?: boolean }>();
          if (body.all) {
            currentStore.clearAllEditorDrafts();
          } else if (body.path) {
            currentStore.deleteEditorDraft(body.path);
          }
          sendJson(200, { ok: true });
          return;
        }

        if (pathname === "/api/server/shutdown" && req.method === "POST") {
          sendJson(200, { status: "shutting_down" });
          setImmediate(() => {
            server.close(() => {
              process.exit(0);
            });
          });
          return;
        }

        // ==================== STATIC FILE SERVING ====================
        let staticPath = path.join(distRendererDir, pathname === "/" ? "index.html" : pathname.slice(1));
        if (!fs.existsSync(staticPath) || fs.statSync(staticPath).isDirectory()) {
          staticPath = path.join(distRendererDir, "index.html");
        }

        if (fs.existsSync(staticPath)) {
          const ext = path.extname(staticPath).toLowerCase();
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          const isHtml = ext === ".html";
          const headers: Record<string, string> = {
            "Content-Type": contentType,
          };
          if (isHtml) {
            // Prevent Electron / Chromium from caching stale index.html builds
            headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0";
            headers["Pragma"] = "no-cache";
            headers["Expires"] = "0";
          } else {
            headers["Cache-Control"] = "no-cache, must-revalidate";
          }
          res.writeHead(200, headers);
          fs.createReadStream(staticPath).pipe(res);
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      } catch (err) {
        console.error("API error:", err);
        sendJson(500, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    server.listen(preferredPort, "127.0.0.1", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : preferredPort;
      const url = `http://127.0.0.1:${actualPort}`;
      resolve({
        server,
        port: actualPort,
        url,
        workspaceRoot: currentWorkspaceRoot,
        close: () =>
          new Promise<void>((resClose) => {
            try {
              currentIndexer?.stopWatching();
              if (typeof (server as any).closeAllConnections === "function") {
                (server as any).closeAllConnections();
              }
              currentStore?.close();
            } catch {}
            server.close(() => resClose());
          }),
        switchWorkspace: (tDir) => initWorkspace(tDir),
      });
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        // Try next port if busy
        startOroServer(initialDir, preferredPort + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
}
