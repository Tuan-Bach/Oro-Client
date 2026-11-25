import type { OroElectronApi, StreamEventPayload, WorkspaceSummary } from "../ipc-types.js";
import type {
  AgentModeId,
  BacklinkInfo,
  MemoryRecord,
  NoteLinkRecord,
  OroConfig,
  ProviderId,
  ChatMessageRecord,
  SessionFileRecord,
  SessionRecord,
  TaskRecord,
  TreeNode,
  VaultSearchHit,
  TurnSnapshotRecord,
  RollbackResult,
  EditorDraftRecord,
  ShiftStatus,
  CoworkerGoal,
  CoworkerTask,
  CoworkerApproval,
  CoworkerSnapshot,
} from "../types.js";

interface NativeWindowBridge {
  isElectron?: boolean;
  selectWorkspaceFolder?: () => Promise<string | null>;
  windowControl?: (action: "minimize" | "maximize" | "close") => Promise<void>;
  setZoomFactor?: (factor: number) => void;
  getZoomFactor?: () => number;
}

declare global {
  interface Window {
    oroNative?: NativeWindowBridge;
  }
}

export function createOroApiClient(baseUrl: string = window.location.origin): OroElectronApi {
  const streamListeners = new Set<(payload: StreamEventPayload) => void>();
  let activeAbortController: AbortController | null = null;
  const isTauri = typeof window !== "undefined" && Boolean((window as any).__TAURI_INTERNALS__);

  if (isTauri) {
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<StreamEventPayload>("stream-event", (event) => {
        streamListeners.forEach((listener) => listener(event.payload));
      });
    }).catch((err) => console.error("Failed to initialize Tauri stream listener:", err));
  }

  async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  async function apiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(endpoint, baseUrl);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const res = await fetch(url.toString());
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async function apiPost<T>(endpoint: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(endpoint, baseUrl).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  async function apiDelete<T>(endpoint: string, body?: unknown): Promise<T> {
    const res = await fetch(new URL(endpoint, baseUrl).toString(), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    getWorkspaceInfo: () => {
      if (isTauri) return tauriInvoke<WorkspaceSummary>("get_workspace_info");
      return apiGet<WorkspaceSummary>("/api/workspace");
    },

    selectWorkspaceFolder: async () => {
      if (isTauri) {
        return tauriInvoke<string | null>("select_workspace_folder");
      }
      // 1. If running inside Electron, use native Electron dialog
      if (window.oroNative?.selectWorkspaceFolder) {
        return window.oroNative.selectWorkspaceFolder();
      }
      // 2. Otherwise trigger backend native folder dialog
      try {
        const res = await apiPost<{ folderPath: string | null }>("/api/dialog/open-folder");
        return res.folderPath;
      } catch {
        return null;
      }
    },

    switchWorkspace: (folderPath: string, options?: { seedStarter?: boolean }) => {
      if (isTauri) {
        return tauriInvoke<any>("set_workspace_root", { path: folderPath }).then(() =>
          tauriInvoke<WorkspaceSummary>("get_workspace_info")
        );
      }
      return apiPost<WorkspaceSummary>("/api/workspace/switch", { folderPath, seedStarter: options?.seedStarter });
    },

    getRecentWorkspaces: () => {
      if (isTauri) return tauriInvoke<Array<{ path: string; name: string; lastOpenedAt: string }>>("get_recent_workspaces");
      return apiGet<Array<{ path: string; name: string; lastOpenedAt: string }>>("/api/workspace/recents");
    },

    getTree: async (subPath?: string) => {
      const raw = isTauri
        ? await tauriInvoke<TreeNode[]>("get_tree", { subPath: subPath || null })
        : await apiGet<TreeNode[]>("/api/tree", subPath ? { subPath } : undefined);
      const normalize = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map((n: any) => ({
          ...n,
          isDir: Boolean(n.isDir || n.type === "directory" || n.node_type === "directory"),
          children: n.children ? normalize(n.children) : undefined,
        }));
      return normalize(raw);
    },

    readFile: (relPath: string) => {
      if (isTauri) return tauriInvoke<{ path: string; content: string; totalLines: number }>("read_file", { path: relPath });
      return apiGet<{ path: string; content: string; totalLines: number }>("/api/file", { path: relPath });
    },

    writeFile: (relPath: string, content: string, encoding?: "utf8" | "base64") => {
      if (isTauri) return tauriInvoke<{ path: string; action: string; bytes: number }>("write_file", { path: relPath, content });
      return apiPost<{ path: string; action: string; bytes: number }>("/api/file", { path: relPath, content, encoding });
    },

    deletePath: (relPath: string) => {
      if (isTauri) {
        return tauriInvoke<string>("delete_path", { path: relPath }).then((trashPath) => ({
          path: relPath,
          trashPath,
        }));
      }
      return apiDelete<{ path: string; trashPath: string }>("/api/file", { path: relPath });
    },

    movePath: (from: string, to: string) => {
      if (isTauri) return tauriInvoke<{ from: string; to: string; updatedLinksIn: string[] }>("move_path", { from, to });
      return apiPost<{ from: string; to: string; updatedLinksIn: string[] }>("/api/file/move", { from, to });
    },

    createFolder: (relPath: string) => {
      if (isTauri) return tauriInvoke<void>("create_folder", { path: relPath }).then(() => ({ path: relPath, created: true }));
      return apiPost<{ path: string; created: boolean }>("/api/folder", { path: relPath });
    },

    reindex: () => {
      if (isTauri) return tauriInvoke<any>("reindex_vault").then((stats) => ({ reindexed: true, stats }));
      return apiPost<{ reindexed: boolean; stats: any }>("/api/workspace/reindex", {});
    },

    openExternal: (relPath?: string) => {
      if (isTauri) {
        return tauriInvoke<{ opener: string }>("open_external", { path: relPath || "" }).then((d) => d.opener);
      }
      return apiPost<{ opener: string }>("/api/open-external", { path: relPath || "" }).then((d) => d.opener);
    },

    revealInExplorer: (relPath?: string) => {
      if (isTauri) {
        return tauriInvoke<{ success: boolean; path: string }>("reveal_in_explorer", { path: relPath || "" });
      }
      return apiPost<{ success: boolean; path: string }>("/api/reveal-in-explorer", { path: relPath || "" });
    },

    getBacklinks: (relPath: string) => {
      if (isTauri) return tauriInvoke<{ outgoing: NoteLinkRecord[]; backlinks: BacklinkInfo[]; tags: string[] }>("get_backlinks", { path: relPath });
      return apiGet<{ outgoing: NoteLinkRecord[]; backlinks: BacklinkInfo[]; tags: string[] }>("/api/backlinks", {
        path: relPath,
      });
    },

    getAllLinks: () => {
      if (isTauri) return tauriInvoke<NoteLinkRecord[]>("get_all_links");
      return apiGet<NoteLinkRecord[]>("/api/links");
    },

    searchVault: (query: string) => {
      if (isTauri) return tauriInvoke<VaultSearchHit[]>("search_vault", { query });
      return apiGet<VaultSearchHit[]>("/api/search", { q: query });
    },

    listSessions: () => {
      if (isTauri) return tauriInvoke<SessionRecord[]>("list_sessions");
      return apiGet<SessionRecord[]>("/api/sessions");
    },

    getSession: (id: string) => {
      if (isTauri) return tauriInvoke<SessionRecord | null>("get_session", { id });
      return apiGet<SessionRecord | null>("/api/session", { id });
    },

    createSession: (title?: string, mode?: AgentModeId) => {
      if (isTauri) return tauriInvoke<SessionRecord>("create_session", { title: title || null, mode: mode || null });
      return apiPost<SessionRecord>("/api/sessions", { title, mode });
    },

    updateSession: (id: string, patch: Partial<{ title: string; mode: AgentModeId }>) => {
      if (isTauri) return tauriInvoke<void>("update_session", { id, title: patch.title || null, mode: patch.mode || null, summary: null });
      return apiPost<void>("/api/session/update", { id, patch });
    },

    deleteSession: (id: string) => {
      if (isTauri) return tauriInvoke<void>("delete_session", { id });
      return apiPost<void>("/api/session/delete", { id });
    },

    listMessages: (sessionId: string) => {
      if (isTauri) return tauriInvoke<ChatMessageRecord[]>("list_messages", { sessionId });
      return apiGet<ChatMessageRecord[]>("/api/messages", { sessionId });
    },

    deleteMessages: (ids: string[]) => {
      if (isTauri) return tauriInvoke<void>("delete_messages", { ids });
      return apiPost<void>("/api/messages/delete", { ids });
    },

    getSessionFiles: (sessionId: string) => {
      if (isTauri) return tauriInvoke<SessionFileRecord[]>("get_session_files", { sessionId });
      return apiGet<SessionFileRecord[]>("/api/session-files", { sessionId });
    },

    setFilePinned: (sessionId: string, relPath: string, pinned: boolean) => {
      if (isTauri) return tauriInvoke<void>("set_file_pinned", { sessionId, path: relPath, pinned });
      return apiPost<void>("/api/session-files/pin", { sessionId, path: relPath, pinned });
    },

    listMemories: (query?: string) => {
      if (isTauri) return tauriInvoke<MemoryRecord[]>("list_memories", { query: query || null });
      return apiGet<MemoryRecord[]>("/api/memories", query ? { q: query } : undefined);
    },

    saveMemory: (content: string, category?: string) => {
      if (isTauri) return tauriInvoke<MemoryRecord>("save_memory", { content, category: category || null });
      return apiPost<MemoryRecord>("/api/memories", { content, category });
    },

    listTasks: () => {
      if (isTauri) return tauriInvoke<TaskRecord[]>("list_tasks_all", { includeDone: true });
      return apiGet<TaskRecord[]>("/api/tasks");
    },

    toggleTask: (id: number, done?: boolean) => {
      if (isTauri) return tauriInvoke<TaskRecord | null>("toggle_task", { id, done: done !== undefined ? done : null });
      return apiPost<TaskRecord | null>("/api/tasks/toggle", { id, done });
    },

    addTask: (title: string, filePath?: string) => {
      if (isTauri) return tauriInvoke<TaskRecord>("add_task", { title, filePath: filePath || null });
      return apiPost<TaskRecord>("/api/tasks", { title, filePath });
    },

    getConfig: () => {
      if (isTauri) return tauriInvoke<OroConfig>("get_config");
      return apiGet<OroConfig>("/api/config");
    },

    saveConfig: (patch: Partial<OroConfig>) => {
      if (isTauri) return tauriInvoke<OroConfig>("save_config", { patch });
      return apiPost<OroConfig>("/api/config", patch);
    },

    saveDefaultBrain: (vaultPath: string) => {
      if (isTauri) return tauriInvoke<void>("save_config", { patch: { defaultBrain: vaultPath } });
      return apiPost<void>("/api/config/brain", { path: vaultPath });
    },

    fetchOllamaModels: async (baseUrl?: string) => {
      const host = (baseUrl || "http://localhost:11434").replace(/\/+$/, "");
      try {
        const res = await fetch(`${host}/api/tags`);
        if (res.ok) {
          const json = (await res.json()) as { models?: Array<{ name?: string }> };
          return (json.models ?? []).map((m) => m.name || "").filter(Boolean);
        }
      } catch {}
      return ["llama3.2", "qwen2.5-coder:7b", "deepseek-r1:8b", "mistral"];
    },

    fetchProviderModels: async (provider: ProviderId, apiKey?: string, baseUrl?: string) => {
      const cleanKey = apiKey?.trim();

      // 1. OLLAMA
      if (provider === "ollama") {
        const host = (baseUrl || "http://localhost:11434").replace(/\/+$/, "");
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2000);
          const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
          clearTimeout(timer);
          if (res.ok) {
            const json = (await res.json()) as { models?: Array<{ name?: string }> };
            const models = (json.models ?? [])
              .map((m) => m.name)
              .filter((n): n is string => Boolean(n))
              .map((name) => ({
                id: name,
                name,
                tag: name.includes("coder") ? "Code" : name.includes("r1") ? "Reasoning" : "Local",
              }));
            if (models.length > 0) return models;
          }
        } catch {}
        return [
          { id: "llama3.2", name: "llama3.2", tag: "Local" },
          { id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b", tag: "Code" },
          { id: "deepseek-r1:8b", name: "deepseek-r1:8b", tag: "Reasoning" },
          { id: "mistral", name: "mistral", tag: "Local" },
        ];
      }

      // Default curated models if no key or offline
      const defaults: Record<ProviderId, Array<{ id: string; name: string; tag: string }>> = {
        gemini: [
          { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", tag: "Fast" },
          { id: "gemini-flash-latest", name: "Gemini Flash Latest", tag: "Fast" },
          { id: "gemini-pro-latest", name: "Gemini Pro Latest", tag: "Reasoning" },
          { id: "gemini-flash-lite-latest", name: "Gemini Flash-Lite Latest", tag: "Ultra-Fast" },
          { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", tag: "Fast" },
          { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", tag: "Ultra-Fast" },
        ],
        openai: [
          { id: "gpt-4o-mini", name: "GPT-4o Mini", tag: "Fast" },
          { id: "gpt-4o", name: "GPT-4o", tag: "Smart" },
          { id: "o3-mini", name: "o3-mini", tag: "Reasoning" },
          { id: "o1", name: "o1", tag: "Reasoning" },
        ],
        anthropic: [
          { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet", tag: "Smart" },
          { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", tag: "Smart" },
          { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", tag: "Fast" },
          { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tag: "Reasoning" },
        ],
        ollama: [],
      };

      if (!cleanKey) {
        return defaults[provider] || [];
      }

      // Live fetch if key is provided
      if (provider === "gemini") {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4500);
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`,
            { signal: controller.signal }
          );
          clearTimeout(timer);
          if (res.ok) {
            const json = (await res.json()) as {
              models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
            };
            const unusableGemini = [
              /\bgemini-[12]\./i,
              /\b(tts|image|banana|transcribe|lyria|robotics|computer-use|embedding|embed|aqa|deep-research|antigravity|argon|carbon|hydrogen|neon|customtools)\b/i,
              /\bgemma\b/i,
            ];
            const list: Array<{ id: string; name: string; tag: string }> = [];
            for (const m of json.models || []) {
              if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
              const cleanId = m.name.replace(/^models\//, "");
              if (unusableGemini.some((re) => re.test(cleanId))) continue;

              const cleanName = (m.displayName || cleanId)
                .replace(/^models\//i, "")
                .replace(/\s+Latest$/i, "");

              const tag = cleanId.includes("flash-lite")
                ? "Ultra-Fast"
                : cleanId.includes("pro")
                ? "Reasoning"
                : cleanId.includes("flash")
                ? "Fast"
                : "General";

              list.push({ id: cleanId, name: cleanName, tag });
            }

            // Score and prioritize modern chat models (gemini-3.8-flash first, latest aliases, flash over pro)
            list.sort((a, b) => {
              const score = (id: string) => {
                let s = 0;
                if (id === "gemini-3.8-flash") return 5000;
                if (id === "gemini-flash-latest") return 4900;
                if (id === "gemini-pro-latest") return 4800;
                if (id === "gemini-flash-lite-latest") return 4700;
                if (id === "gemini-3.5-flash") return 4600;
                if (id === "gemini-3.1-flash-lite") return 4500;
                if (id === "gemini-3.1-pro-preview") return 4400;
                if (id === "gemini-3-flash-preview") return 4300;

                if (id.includes("3.8")) s += 3800;
                else if (id.includes("3.5")) s += 3500;
                else if (id.includes("3.1")) s += 3100;
                else if (id.includes("3.")) s += 3000;
                else s += 1000;

                if (id.includes("flash-lite")) s += 80;
                else if (id.includes("flash")) s += 120;
                else if (id.includes("pro")) s += 100;

                if (/\d{4}-\d{2}|\d{8}/.test(id)) s -= 200;
                if (id.includes("exp") || id.includes("preview")) s -= 50;
                return s;
              };
              return score(b.id) - score(a.id);
            });

            if (list.length > 0) return list.slice(0, 10);
          }
        } catch {}
      }

      if (provider === "openai") {
        const host = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4500);
          const res = await fetch(`${host}/models`, {
            headers: { Authorization: `Bearer ${cleanKey}` },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            const json = (await res.json()) as { data?: Array<{ id: string }> };
            const excluded = [
              "whisper", "tts", "dall-e", "embedding", "moderation", "realtime",
              "audio", "instruct", "babbage", "davinci", "search", "similarity", "curie"
            ];
            const list = (json.data || [])
              .filter((item) => {
                const id = item.id.toLowerCase();
                return !excluded.some((ex) => id.includes(ex)) &&
                  (id.startsWith("gpt-") || id.startsWith("o1") || id.startsWith("o3") || id.startsWith("chatgpt-"));
              })
              .map((item) => ({
                id: item.id,
                name: item.id,
                tag: item.id.includes("mini") ? "Fast" : item.id.startsWith("o") ? "Reasoning" : "Smart",
              }));

            list.sort((a, b) => {
              const score = (id: string) => {
                let s = 0;
                if (id === "gpt-4o-mini") return 3000;
                if (id === "gpt-4o") return 2900;
                if (id === "o3-mini") return 2800;
                if (id === "o1") return 2700;
                if (id.includes("gpt-4o")) s += 500;
                else if (id.includes("o3")) s += 450;
                else if (id.includes("o1")) s += 400;
                if (id.includes("mini")) s += 50;
                if (/\d{4}-\d{2}/.test(id)) s -= 100;
                return s;
              };
              return score(b.id) - score(a.id);
            });

            if (list.length > 0) return list.slice(0, 10);
          }
        } catch {}
      }

      if (provider === "anthropic") {
        const host = (baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 4500);
          const res = await fetch(`${host}/models`, {
            headers: {
              "x-api-key": cleanKey,
              "anthropic-version": "2023-06-01",
            },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) {
            const json = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
            const list = (json.data || [])
              .filter((item) => item.id.includes("claude"))
              .map((item) => ({
                id: item.id,
                name: item.display_name || item.id,
                tag: item.id.includes("haiku") ? "Fast" : item.id.includes("3-7") || item.id.includes("sonnet") ? "Smart" : "Reasoning",
              }));

            list.sort((a, b) => {
              const score = (id: string) => {
                if (id === "claude-3-7-sonnet-latest") return 3000;
                if (id === "claude-3-5-sonnet-latest") return 2900;
                if (id === "claude-3-5-haiku-latest") return 2800;
                let s = 0;
                if (id.includes("3-7")) s += 500;
                else if (id.includes("3-5")) s += 400;
                if (id.includes("sonnet")) s += 100;
                if (id.includes("haiku")) s += 80;
                return s;
              };
              return score(b.id) - score(a.id);
            });

            if (list.length > 0) return list.slice(0, 8);
          }
        } catch {}
      }

      return defaults[provider] || [];
    },

    saveProviderKey: (provider: ProviderId, apiKey: string) => {
      if (isTauri) return tauriInvoke<void>("save_provider_key", { provider, apiKey });
      return apiPost<void>("/api/config/key", { provider, apiKey });
    },

    saveProviderModel: (
      provider: ProviderId,
      model: string,
      baseUrl?: string,
      reasoningEffort?: "low" | "medium" | "high"
    ) => {
      if (isTauri) return tauriInvoke<void>("save_provider_model", { provider, model, baseUrl: baseUrl || null, reasoningEffort: reasoningEffort || null });
      return apiPost<void>("/api/config/model", { provider, model, baseUrl, reasoningEffort });
    },

    sendChatMessage: async ({ sessionId, mode, prompt }) => {
      if (isTauri) {
        return tauriInvoke<void>("send_chat_message", { sessionId, mode: mode || null, prompt });
      }

      const controller = new AbortController();
      activeAbortController = controller;

      try {
        const res = await fetch(new URL("/api/chat", baseUrl).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, mode, prompt }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const block of parts) {
            const line = block.trim();
            if (line.startsWith("data: ")) {
              try {
                const payload = JSON.parse(line.slice(6)) as StreamEventPayload;
                streamListeners.forEach((listener) => listener(payload));
              } catch (parseErr) {
                console.error("SSE parse error:", parseErr);
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        streamListeners.forEach((listener) => listener({ type: "error", error: errorMsg }));
      } finally {
        activeAbortController = null;
      }
    },

    cancelChat: async () => {
      if (isTauri) {
        return tauriInvoke<void>("cancel_chat");
      }
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
    },

    onChatStream: (callback: (payload: StreamEventPayload) => void) => {
      streamListeners.add(callback);
      return () => {
        streamListeners.delete(callback);
      };
    },

    summarizeSession: (sessionId: string) =>
      apiPost<{
        summary: string;
        memoriesAdded: number;
        tasksAdded: number;
        notePath: string;
      }>("/api/summarize", { sessionId }),

    listSnapshots: (sessionId: string) => {
      if (isTauri) return tauriInvoke<TurnSnapshotRecord[]>("list_snapshots", { sessionId });
      return apiGet<TurnSnapshotRecord[]>("/api/snapshots", { sessionId });
    },

    rollbackSnapshot: (snapshotId: string) => {
      if (isTauri) return tauriInvoke<RollbackResult>("rollback_snapshot", { snapshotId });
      return apiPost<RollbackResult>("/api/snapshots/rollback", { snapshotId });
    },

    listDrafts: () => {
      if (isTauri) return tauriInvoke<EditorDraftRecord[]>("list_drafts");
      return apiGet<EditorDraftRecord[]>("/api/drafts");
    },

    saveDraft: (filePath: string, content: string) => {
      if (isTauri) return tauriInvoke<void>("save_draft", { path: filePath, content });
      return apiPost<{ ok: boolean }>("/api/drafts", { path: filePath, content }).then(() => {});
    },

    deleteDraft: (filePath: string) => {
      if (isTauri) return tauriInvoke<void>("delete_draft", { path: filePath });
      return apiDelete<{ ok: boolean }>("/api/drafts", { path: filePath }).then(() => {});
    },

    clearAllDrafts: () => {
      if (isTauri) return tauriInvoke<void>("clear_all_drafts");
      return apiDelete<{ ok: boolean }>("/api/drafts", { all: true }).then(() => {});
    },

    windowControl: async (action: "minimize" | "maximize" | "close") => {
      if (isTauri) {
        return tauriInvoke("window_control", { action });
      }
      if (window.oroNative?.windowControl) {
        await window.oroNative.windowControl(action);
      }
    },

    setZoomFactor: async (factor: number) => {
      if (isTauri) {
        return tauriInvoke("set_zoom_factor", { factor });
      }
      if (window.oroNative?.setZoomFactor) {
        window.oroNative.setZoomFactor(factor);
      }
    },

    // 24/7 Co-Worker Tauri / REST IPC
    getShiftStatus: async (): Promise<ShiftStatus> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<ShiftStatus>("get_shift_status");
      }
      return apiGet<ShiftStatus>("/api/coworker/status");
    },

    setShiftStatus: async (status: ShiftStatus): Promise<ShiftStatus> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<ShiftStatus>("set_shift_status", { status });
      }
      return apiPost<ShiftStatus>("/api/coworker/shift", { status });
    },

    createCoworkerGoal: async (title: string, description?: string, tokenBudget?: number): Promise<CoworkerGoal> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<CoworkerGoal>("create_goal", { title, description, tokenBudget });
      }
      return apiPost<CoworkerGoal>("/api/coworker/goals", { title, description, tokenBudget });
    },

    getActiveCoworkerGoal: async (): Promise<CoworkerGoal | null> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<CoworkerGoal | null>("get_active_goal");
      }
      return apiGet<CoworkerGoal | null>("/api/coworker/goals/active");
    },

    createCoworkerTask: async (
      goalId: string,
      title: string,
      role: string,
      modelTier: string,
      dependencies: string[]
    ): Promise<CoworkerTask> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<CoworkerTask>("create_task", {
          goalId,
          title,
          role,
          modelTier,
          dependencies,
        });
      }
      return apiPost<CoworkerTask>("/api/coworker/tasks", {
        goalId,
        title,
        role,
        modelTier,
        dependencies,
      });
    },

    listCoworkerTasks: async (goalId: string): Promise<CoworkerTask[]> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<CoworkerTask[]>("list_tasks", { goalId });
      }
      return apiGet<CoworkerTask[]>("/api/coworker/tasks", { goalId });
    },

    listCoworkerApprovals: async (goalId?: string): Promise<CoworkerApproval[]> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<CoworkerApproval[]>("list_approvals", { goalId });
      }
      return apiGet<CoworkerApproval[]>("/api/coworker/approvals", goalId ? { goalId } : undefined);
    },

    resolveCoworkerApproval: async (id: string, approved: boolean, note?: string): Promise<string[]> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<string[]>("resolve_approval", { id, approved, note });
      }
      return apiPost<string[]>("/api/coworker/approvals/resolve", { id, approved, note });
    },

    getCoworkerSnapshot: async (): Promise<CoworkerSnapshot> => {
      if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke<CoworkerSnapshot>("get_coworker_snapshot");
      }
      return apiGet<CoworkerSnapshot>("/api/coworker/snapshot");
    },
  };
}
