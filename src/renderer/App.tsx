import React, { useCallback, useEffect, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar.js";
import { SidebarDrawer } from "./components/SidebarDrawer.js";
import { ChatPanel, type ChatMessageUI } from "./components/ChatPanel.js";
import { EditorPanel, type OpenTab } from "./components/EditorPanel.js";
import { ModelSetupModal } from "./components/ModelSetupModal.js";
import { SettingsModal, getFontStack } from "./components/SettingsModal.js";
import { WorkspaceModal } from "./components/WorkspaceModal.js";
import { SessionConfigModal } from "./components/SessionConfigModal.js";
import { PromptModal } from "./components/PromptModal.js";
import { SplitResizer } from "./components/SplitResizer.js";
import { QuickSwitcherModal } from "./components/QuickSwitcherModal.js";
import { SplashScreen } from "./components/SplashScreen.js";
import { recordUsage } from "./utils/usageTracker.js";
import type {
  AgentModeId,
  MemoryRecord,
  OroConfig,
  ProviderId,
  SessionFileRecord,
  SessionRecord,
  TaskRecord,
  TreeNode,
} from "../types.js";
import type { WorkspaceSummary, StreamEventPayload } from "../ipc-types.js";
import {
  isDefaultSessionTitle,
  generateNewSessionTitle,
  generateShortSessionTitle,
} from "../agent/session-naming.js";

export const App: React.FC = () => {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [config, setConfig] = useState<OroConfig | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [activeSession, setActiveSession] = useState<SessionRecord | null>(null);
  const [mode, setMode] = useState<AgentModeId>("default");
  const [decidedMode, setDecidedMode] = useState<"plan" | "builder" | "triad" | null>(null);

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [sessionFiles, setSessionFiles] = useState<SessionFileRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessageUI[]>([]);

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAppReady, setIsAppReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [activeModal, setActiveModal] = useState<"settings" | "model" | "workspace" | "workspace_create" | "new_file" | "new_folder" | "session_config" | null>(null);
  const [sessionToConfigure, setSessionToConfigure] = useState<SessionRecord | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDockMode, setEditorDockMode] = useState<"floating" | "split">(() => {
    try {
      return (localStorage.getItem("oro_editor_dock_mode") as "floating" | "split") || "floating";
    } catch {
      return "floating";
    }
  });

  const handleToggleEditorDockMode = () => {
    setEditorDockMode((prev) => {
      const next = prev === "floating" ? "split" : "floating";
      try { localStorage.setItem("oro_editor_dock_mode", next); } catch {}
      return next;
    });
  };

  const [viewMode, setViewMode] = useState<"editor" | "split" | "preview" | "diff">("split");
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<"dark" | "light" | "monokai">(() => {
    try {
      return (localStorage.getItem("oro_theme") as "dark" | "light" | "monokai") || "dark";
    } catch {
      return "dark";
    }
  });
  const [zenMode, setZenMode] = useState<"none" | "editor" | "chat">("none");
  const [isReindexing, setIsReindexing] = useState(false);
  const autoSaveTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Draggable column widths with localStorage persistence
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("oro_sidebar_width");
      return saved ? Math.max(180, Math.min(480, parseInt(saved, 10))) : 250;
    } catch {
      return 250;
    }
  });

  const [chatWidth, setChatWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("oro_chat_width");
      return saved ? Math.max(280, Math.min(800, parseInt(saved, 10))) : 420;
    } catch {
      return 420;
    }
  });

  const handleSidebarResize = (deltaX: number) => {
    setSidebarWidth((prev) => {
      const maxAllowed = Math.max(180, window.innerWidth - chatWidth - 240);
      const next = Math.max(180, Math.min(Math.min(380, maxAllowed), prev + deltaX));
      try { localStorage.setItem("oro_sidebar_width", String(next)); } catch {}
      return next;
    });
  };

  const handleChatResize = (deltaX: number) => {
    setChatWidth((prev) => {
      const effectiveSidebar = sidebarOpen ? sidebarWidth : 0;
      const maxAllowed = Math.max(220, window.innerWidth - effectiveSidebar - 240);
      const next = Math.max(220, Math.min(maxAllowed, prev + deltaX));
      try { localStorage.setItem("oro_chat_width", String(next)); } catch {}
      return next;
    });
  };

  const [floatingEditorWidth, setFloatingEditorWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("oro_floating_editor_width");
      return saved ? Math.max(340, Math.min(1000, parseInt(saved, 10))) : 540;
    } catch {
      return 540;
    }
  });
  const [isFloatingExpanded, setIsFloatingExpanded] = useState<boolean>(false);
  const [recoverableDrafts, setRecoverableDrafts] = useState<import("../types.js").EditorDraftRecord[]>([]);

  const handleFloatingEditorResize = (deltaX: number) => {
    setIsFloatingExpanded(false);
    setFloatingEditorWidth((prev) => {
      const maxAllowed = Math.max(340, window.innerWidth - (sidebarOpen ? sidebarWidth : 0) - 200);
      const next = Math.max(320, Math.min(maxAllowed, prev - deltaX));
      try { localStorage.setItem("oro_floating_editor_width", String(next)); } catch {}
      return next;
    });
  };

  // Prevent unhandled window-level drag/drop events from causing Electron navigation
  useEffect(() => {
    const handleGlobalDragOver = (e: DragEvent) => e.preventDefault();
    const handleGlobalDrop = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", handleGlobalDragOver);
    window.addEventListener("drop", handleGlobalDrop);
    return () => {
      window.removeEventListener("dragover", handleGlobalDragOver);
      window.removeEventListener("drop", handleGlobalDrop);
    };
  }, []);

  // Responsive scaling: Adjust panel widths whenever window is resized or dragged down
  useEffect(() => {
    const handleWindowResize = () => {
      const winW = window.innerWidth;
      const effectiveSidebar = sidebarOpen ? sidebarWidth : 0;
      const available = winW - effectiveSidebar - 36;
      if (available < 500) {
        const targetChat = Math.max(200, Math.floor(available * 0.48));
        setChatWidth(targetChat);
      } else {
        setChatWidth((cur) => Math.min(cur, available - 220));
      }
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [sidebarOpen, sidebarWidth]);

  const streamTimerRef = useRef<number | null>(null);

  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const records = await window.oro.listMessages(sessionId);
      if (records && records.length > 0) {
        const toolResultsById = new Map<string, { content: string; ok: boolean }>();
        for (const r of records) {
          if (r.role === "tool" && r.toolCallId) {
            const isErr =
              r.content.startsWith("Exit code: 1") ||
              r.content.startsWith("Error") ||
              r.content.includes("API error") ||
              r.content.includes("failed") ||
              r.content.startsWith("Missing ") ||
              r.content.startsWith("Invalid ");
            toolResultsById.set(r.toolCallId, { content: r.content, ok: !isErr });
          }
        }

        const uiMsgs: ChatMessageUI[] = [];
        let pendingTools: NonNullable<ChatMessageUI["toolCalls"]> = [];

        for (const r of records) {
          if (r.role === "user" || r.role === "system") {
            if (pendingTools.length > 0) {
              uiMsgs.push({
                id: `tools_${r.id}`,
                role: "assistant",
                content: "",
                toolCalls: pendingTools,
              });
              pendingTools = [];
            }
            uiMsgs.push({
              id: r.id,
              role: r.role as "user" | "system",
              content: r.content,
            });
          } else if (r.role === "assistant") {
            let parsedCalls: NonNullable<ChatMessageUI["toolCalls"]> = [];
            if (r.toolArgs) {
              try {
                const raw = JSON.parse(r.toolArgs);
                if (Array.isArray(raw)) {
                  parsedCalls = raw.map((tc: any) => {
                    const res = toolResultsById.get(tc.id);
                    return {
                      id: tc.id || `tc_${Math.random()}`,
                      name: tc.name || "tool",
                      args: tc.args || {},
                      status: res ? (res.ok ? "done" : "error") : "done",
                      output: res?.content,
                    };
                  });
                }
              } catch {}
            }
            if (parsedCalls.length > 0 && !r.content) {
              pendingTools.push(...parsedCalls);
            } else {
              const allTools = [...pendingTools, ...parsedCalls];
              pendingTools = [];
              uiMsgs.push({
                id: r.id,
                role: "assistant",
                content: r.content,
                toolCalls: allTools.length > 0 ? allTools : undefined,
              });
            }
          }
        }
        if (pendingTools.length > 0) {
          uiMsgs.push({
            id: `tools_end_${Date.now()}`,
            role: "assistant",
            content: "",
            toolCalls: pendingTools,
          });
        }
        setMessages(uiMsgs);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error("Failed to load messages for session:", err);
      setMessages([]);
    }
  }, []);

  // Initial load
  const reloadWorkspace = useCallback(async () => {
    const initStart = Date.now();
    try {
      // Parallelize workspace initialization requests to eliminate startup waterfalls
      const [wsInfo, cfg, treeData, taskList, memList, sessList] = await Promise.all([
        window.oro.getWorkspaceInfo(),
        window.oro.getConfig(),
        window.oro.getTree(),
        window.oro.listTasks(),
        window.oro.listMemories(),
        window.oro.listSessions(),
      ]);

      setWorkspace(wsInfo);
      try {
        localStorage.setItem("oro_last_workspace", wsInfo.root);
      } catch {}
      setConfig(cfg);

      // Apply theme, system font, and UI scale
      const theme = (cfg?.ui?.theme as "dark" | "light" | "monokai") || (localStorage.getItem("oro_theme") as "dark" | "light" | "monokai") || "dark";
      const rawScale = cfg?.ui?.systemScale || Number(localStorage.getItem("oro_system_scale")) || 100;
      const systemScale = [80, 90, 100, 110, 120, 130].includes(rawScale) ? rawScale : 100;
      const systemFont = cfg?.ui?.systemFont || localStorage.getItem("oro_system_font") || "inter";

      document.documentElement.setAttribute("data-theme", theme);
      setCurrentTheme(theme);

      // Default scale 100% renders at 120% of original scale (1.20 factor)
      const zoomFactor = (systemScale / 100) * 1.20;
      if (window.oro?.setZoomFactor) {
        window.oro.setZoomFactor(zoomFactor);
      } else if (window.oroNative?.setZoomFactor) {
        window.oroNative.setZoomFactor(zoomFactor);
      }

      // Base font size 13px
      document.documentElement.style.setProperty("--system-font-size", "13px");
      document.documentElement.style.fontSize = "13px";
      document.body.style.fontSize = "13px";

      const fontStack = getFontStack(systemFont);
      document.documentElement.style.setProperty("--system-font", fontStack);
      document.body.style.fontFamily = fontStack;

      setTree(treeData);
      setTasks(taskList);
      setMemories(memList);

      // Reverse order so older sessions are on left, newest session is on right
      const orderedSessions = [...sessList].reverse();
      setSessions(orderedSessions);
      if (orderedSessions.length > 0) {
        let cur: SessionRecord = orderedSessions[orderedSessions.length - 1]!;
        try {
          const savedSessionId = localStorage.getItem("oro_active_session_id");
          if (savedSessionId) {
            const found = orderedSessions.find((s) => s.id === savedSessionId);
            if (found) cur = found;
          }
        } catch {}

        setActiveSession(cur);
        setMode(cur.mode);
        try {
          const [sFiles] = await Promise.all([
            window.oro.getSessionFiles(cur.id),
            loadSessionMessages(cur.id),
          ]);
          setSessionFiles(sFiles);
        } catch (e) {
          console.error("Failed to load initial session files/messages:", e);
        }
      }

      // Check for crash recovery drafts
      try {
        const drafts = await window.oro.listDrafts();
        if (drafts && drafts.length > 0) {
          setRecoverableDrafts(drafts);
        }
      } catch {}
    } catch (err) {
      console.error("Workspace init failed:", err);
    } finally {
      const elapsed = Date.now() - initStart;
      const minExperienceMs = 600;
      const delay = Math.max(0, minExperienceMs - elapsed);
      setTimeout(() => {
        setIsAppReady(true);
      }, delay);
    }
  }, [loadSessionMessages]);

  useEffect(() => {
    reloadWorkspace();
  }, [reloadWorkspace]);

  const handleToggleTheme = useCallback(async () => {
    const cycle: Record<"dark" | "light" | "monokai", "dark" | "light" | "monokai"> = {
      dark: "light",
      light: "monokai",
      monokai: "dark",
    };
    const nextTheme = cycle[currentTheme] || "dark";
    setCurrentTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
    try {
      localStorage.setItem("oro_theme", nextTheme);
      if (config) {
        const updated = await window.oro.saveConfig({
          ui: { ...config.ui, theme: nextTheme },
        });
        setConfig(updated);
      }
    } catch {}
  }, [currentTheme, config]);

  // Global hotkeys: Ctrl+, (Settings), Ctrl+K / Ctrl+P (Command Palette), Ctrl+Shift+Z (Zen Focus), Ctrl+Shift+B (Neuron Tree)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (isCmdOrCtrl && e.key === ",") {
        e.preventDefault();
        setActiveModal((cur) => (cur === "settings" ? null : "settings"));
      } else if (isCmdOrCtrl && (e.key === "p" || e.key === "P" || e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setQuickSwitcherOpen((cur) => !cur);
      } else if (isCmdOrCtrl && (e.key === "e" || e.key === "E")) {
        e.preventDefault();
        setEditorOpen((cur) => !cur);
      } else if (isCmdOrCtrl && !e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setActiveModal("new_file");
      } else if (isCmdOrCtrl && e.shiftKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setActiveModal("new_folder");
      } else if (isCmdOrCtrl && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        setZenMode((cur) => (cur === "editor" ? "none" : "editor"));
      } else if (e.key === "Escape") {
        // Priority 1: Dismiss active popup modal (Settings, Workspace selector, New Workspace, PromptModal)
        if (activeModal) {
          e.preventDefault();
          setActiveModal(null);
        } else if (quickSwitcherOpen) {
          e.preventDefault();
          setQuickSwitcherOpen(false);
        } else if (editorOpen && editorDockMode === "floating") {
          e.preventDefault();
          setEditorOpen(false);
        } else if (zenMode !== "none") {
          e.preventDefault();
          setZenMode("none");
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeModal, quickSwitcherOpen, editorOpen, editorDockMode, zenMode]);

  // Preload initial note into tabs memory without eagerly forcing editor open on launch
  useEffect(() => {
    if (tabs.length === 0 && tree.length > 0) {
      const candidates = ["Notes/Welcome.md", "README.md", "Projects/Roadmap.md"];
      for (const c of candidates) {
        const found = tree.find((n) => n.path === c || (n.children && n.children.some((sub) => sub.path === c)));
        if (found) {
          window.oro.readFile(c).then((fileData) => {
            const initialTab: OpenTab = {
              path: fileData.path,
              title: fileData.path.split("/").pop() || fileData.path,
              content: fileData.content,
              originalContent: fileData.content,
              isDirty: false,
              isPreview: false,
            };
            setTabs([initialTab]);
            setActiveTabPath(fileData.path);
          }).catch(() => {});
          return;
        }
      }
    }
  }, [tree]);

  // Single-click / tap: Preview file in reading view (replaces existing clean preview tab)
  const handlePreviewFile = async (relPath: string) => {
    setEditorOpen(true);
    setActiveTabPath(relPath);
    const existingIndex = tabs.findIndex((t) => t.path === relPath);
    if (existingIndex >= 0) {
      setActiveTabPath(relPath);
      return;
    }

    try {
      const fileData = await window.oro.readFile(relPath);
      const newTab: OpenTab = {
        path: fileData.path,
        title: fileData.path.split("/").pop() || fileData.path,
        content: fileData.content,
        originalContent: fileData.content,
        isDirty: false,
        isPreview: true, // Transient preview mode
      };

      // Replace existing clean preview tab if one exists, otherwise append
      setTabs((prev) => {
        const previewIdx = prev.findIndex((t) => t.isPreview && !t.isDirty);
        if (previewIdx >= 0) {
          const next = [...prev];
          next[previewIdx] = newTab;
          return next;
        }
        return [...prev, newTab];
      });

      setActiveTabPath(fileData.path);
    } catch (err) {
      console.error(`Cannot preview ${relPath}:`, err);
    }
  };

  // Double-click / tap: Open permanently on the right (pins tab, opens editor)
  const handleOpenFile = async (relPath: string) => {
    setEditorOpen(true);
    const existingIndex = tabs.findIndex((t) => t.path === relPath);
    if (existingIndex >= 0) {
      // Promote from preview to permanent
      setTabs((prev) =>
        prev.map((t, idx) => (idx === existingIndex ? { ...t, isPreview: false } : t))
      );
      setActiveTabPath(relPath);
      return;
    }

    try {
      const fileData = await window.oro.readFile(relPath);
      const newTab: OpenTab = {
        path: fileData.path,
        title: fileData.path.split("/").pop() || fileData.path,
        content: fileData.content,
        originalContent: fileData.content,
        isDirty: false,
        isPreview: false, // Permanent
      };

      // If replacing a clean preview tab
      setTabs((prev) => {
        const previewIdx = prev.findIndex((t) => t.isPreview && !t.isDirty);
        if (previewIdx >= 0) {
          const next = [...prev];
          next[previewIdx] = newTab;
          return next;
        }
        return [...prev, newTab];
      });

      setActiveTabPath(fileData.path);

      if (activeSession) {
        const sFiles = await window.oro.getSessionFiles(activeSession.id);
        setSessionFiles(sFiles);
      }
    } catch (err) {
      console.error(`Cannot open ${relPath}:`, err);
    }
  };

  // Pin a tab from preview to permanent
  const handlePinTab = (path: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.path === path ? { ...t, isPreview: false } : t))
    );
  };

  const handleCloseTab = (path: string) => {
    window.oro.deleteDraft(path).catch(() => {});
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (next.length === 0) {
        setActiveTabPath(null);
        setEditorOpen(false);
      } else if (activeTabPath === path) {
        setActiveTabPath(next[next.length - 1]!.path);
      }
      return next;
    });
  };

  const handleCloseOtherTabs = (path: string) => {
    setTabs((prev) => prev.filter((t) => t.path === path));
    setActiveTabPath(path);
  };

  const handleCloseTabsToRight = (path: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const next = prev.slice(0, idx + 1);
      if (!next.some((t) => t.path === activeTabPath)) {
        setActiveTabPath(path);
      }
      return next;
    });
  };

  const handleUpdateContent = (path: string, newContent: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.path === path
          ? {
              ...t,
              content: newContent,
              isDirty: false, // Seamless silent auto-save
              isPreview: false,
            }
          : t
      )
    );

    // 1. Immediately persist dirty buffer to local SQLite draft journal
    window.oro.saveDraft(path, newContent).catch(() => {});

    // 2. Silent background auto-save after 700ms of inactivity
    const existing = autoSaveTimersRef.current.get(path);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      try {
        await window.oro.writeFile(path, newContent);
        await window.oro.deleteDraft(path).catch(() => {});
        setTabs((prev) =>
          prev.map((t) => (t.path === path ? { ...t, originalContent: newContent, isDirty: false } : t))
        );
        autoSaveTimersRef.current.delete(path);
      } catch (err) {
        console.error(`Auto-save error for ${path}:`, err);
      }
    }, 700);

    autoSaveTimersRef.current.set(path, timer);
  };

  const handleSaveFile = async (path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return;
    try {
      await window.oro.writeFile(path, tab.content);
      await window.oro.deleteDraft(path).catch(() => {});
      setTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, originalContent: tab.content, isDirty: false } : t))
      );
      const treeData = await window.oro.getTree();
      setTree(treeData);
      if (activeSession) {
        const sFiles = await window.oro.getSessionFiles(activeSession.id);
        setSessionFiles(sFiles);
      }
    } catch (err) {
      console.error(`Save failed for ${path}:`, err);
    }
  };

  const handleMovePath = async (fromRel: string, toRel: string) => {
    try {
      const res = await window.oro.movePath(fromRel, toRel);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.path === fromRel) {
            return {
              ...t,
              path: toRel,
              title: toRel.split("/").pop()?.replace(/\.md$/, "") || toRel,
            };
          }
          if (t.path.startsWith(`${fromRel}/`)) {
            const updated = toRel + t.path.slice(fromRel.length);
            return {
              ...t,
              path: updated,
              title: updated.split("/").pop()?.replace(/\.md$/, "") || updated,
            };
          }
          return t;
        })
      );
      if (activeTabPath === fromRel) {
        setActiveTabPath(toRel);
      } else if (activeTabPath && activeTabPath.startsWith(`${fromRel}/`)) {
        setActiveTabPath(toRel + activeTabPath.slice(fromRel.length));
      }
      await window.oro.reindex().catch(() => {});
      const treeData = await window.oro.getTree();
      setTree(treeData);
      const wsInfo = await window.oro.getWorkspaceInfo();
      setWorkspace(wsInfo);
      return res;
    } catch (err) {
      console.error(`Move failed from ${fromRel} to ${toRel}:`, err);
    }
  };

  // Switch AI Provider & Model dynamically from Chat Box
  const handleModelChange = async (
    provider: ProviderId,
    model: string,
    reasoningEffort?: "low" | "medium" | "high"
  ) => {
    try {
      const currentEffort = reasoningEffort ?? config?.providers[provider]?.reasoningEffort;
      await window.oro.saveProviderModel(provider, model, undefined, currentEffort);
      if (provider !== config?.provider) {
        await window.oro.saveConfig({ provider });
      }
      const updated = await window.oro.getConfig();
      setConfig(updated);
    } catch (err) {
      console.error("Failed to change model:", err);
    }
  };

  // Follow [[wiki-links]] clicked inside Markdown preview
  const handleFollowWikiLink = async (target: string) => {
    const clean = target.replace(/\\/g, "/").replace(/\.md$/i, "").trim();
    // 1. Search notes with that title or path
    const hits = await window.oro.searchVault(clean);
    if (hits.length > 0) {
      handleOpenFile(hits[0]!.path);
      return;
    }
    // 2. If not found, open Notes/{target}.md (or create starter)
    const newPath = clean.includes("/") ? `${clean}.md` : `Notes/${clean}.md`;
    try {
      await window.oro.writeFile(
        newPath,
        `---\ntitle: "${clean}"\ndate: ${new Date().toISOString().slice(0, 10)}\ntags: []\n---\n\n# ${clean}\n\n`
      );
      const treeData = await window.oro.getTree();
      setTree(treeData);
      handleOpenFile(newPath);
    } catch {
      // ignore
    }
  };

  // Chat message submission & live streaming
  const handleSendMessage = async (prompt: string) => {
    let session = activeSession;
    if (!session) {
      session = await window.oro.createSession("New Session", mode);
      try {
        localStorage.setItem("oro_active_session_id", session.id);
      } catch {}
      setSessions((prev) => [...prev, session!]);
      setActiveSession(session);
    }
    const userMsgId = `u_${Date.now()}`;
    const assistantMsgId = `a_${Date.now()}`;

    // Auto-rename session instantly on first prompt if currently using a placeholder title
    if (isDefaultSessionTitle(session.title)) {
      const smartTitle = generateShortSessionTitle(prompt);
      if (smartTitle && smartTitle !== session.title) {
        window.oro.updateSession(session.id, { title: smartTitle }).catch(console.error);
        setSessions((prev) =>
          prev.map((s) => (s.id === session!.id ? { ...s, title: smartTitle } : s))
        );
        setActiveSession((prev) => (prev ? { ...prev, title: smartTitle } : null));
      }
    }

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: prompt },
      { id: assistantMsgId, role: "assistant", content: "", toolCalls: [], streaming: true },
    ]);

    setIsStreaming(true);
    setDecidedMode(null);

    // Smooth fluid streaming ticker (natural, readable token cadence like Claude / Antigravity)
    let pendingStreamText = "";
    let displayedStreamText = "";
    let isStreamDone = false;
    let finalError: string | null = null;

    const pumpStream = () => {
      if (displayedStreamText.length < pendingStreamText.length) {
        const remaining = pendingStreamText.length - displayedStreamText.length;
        // Paces small batches smoothly (2-4 chars per frame ~80-120 chars/sec),
        // scales up if large chunks arrive so it never lags behind
        const step = remaining > 160 ? Math.ceil(remaining / 4) : remaining > 60 ? 12 : remaining > 20 ? 8 : 4;
        displayedStreamText = pendingStreamText.slice(0, displayedStreamText.length + step);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: displayedStreamText } : m
          )
        );
      }

      if (displayedStreamText.length < pendingStreamText.length) {
        streamTimerRef.current = window.setTimeout(pumpStream, 32);
      } else if (isStreamDone) {
        setIsStreaming(false);
        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  streaming: false,
                  content: finalError ? `${pendingStreamText}\n\n⚠ ${finalError}` : pendingStreamText,
                }
              : m
          );
          const assistantMsg = updated.find((m) => m.id === assistantMsgId);
          if (assistantMsg && !finalError) {
            const p = config?.provider || "gemini";
            const m = config?.providers[p]?.model || "gemini-3.8-flash";
            recordUsage(p, m, prompt, assistantMsg.content);
          }
          return updated;
        });
        window.oro.getTree().then(setTree);
        window.oro.getSessionFiles(session.id).then(setSessionFiles);
        streamTimerRef.current = null;
      } else {
        streamTimerRef.current = null;
      }
    };

    const unsubscribe = window.oro.onChatStream((payload: StreamEventPayload) => {
      if (payload.type === "session_renamed" && payload.title) {
        const renamed = payload.title;
        setSessions((prev) =>
          prev.map((s) => (s.id === session!.id ? { ...s, title: renamed } : s))
        );
        setActiveSession((prev) => (prev ? { ...prev, title: renamed } : null));
      } else if (payload.type === "mode_decided" && payload.mode) {
        setDecidedMode(payload.mode);
      } else if (payload.type === "text" && payload.textDelta) {
        pendingStreamText += payload.textDelta;
        if (!streamTimerRef.current) {
          pumpStream();
        }
      } else if (payload.type === "tool_call" && payload.toolCall) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsgId) return m;
            const calls = m.toolCalls ? [...m.toolCalls] : [];
            calls.push({
              id: payload.toolCall!.id,
              name: payload.toolCall!.name,
              args: payload.toolCall!.args,
              status: "running",
            });
            return { ...m, toolCalls: calls };
          })
        );
      } else if (payload.type === "tool_result" && payload.toolResult) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsgId) return m;
            const calls = m.toolCalls ? [...m.toolCalls] : [];
            const idx = calls.findIndex((c) => c.id === payload.toolResult!.id);
            if (idx >= 0) {
              calls[idx] = {
                ...calls[idx]!,
                status: payload.toolResult!.ok ? "done" : "error",
                summary: payload.toolResult!.summary,
                output: payload.toolResult!.output,
              };
            }
            return { ...m, toolCalls: calls };
          })
        );
        // Instantly refresh file tree and session files the moment a tool finishes execution
        window.oro.getTree().then(setTree).catch(console.error);
        if (activeSession) {
          window.oro.getSessionFiles(activeSession.id).then(setSessionFiles).catch(console.error);
        }
      } else if (payload.type === "subagent" && payload.subagent) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsgId) return m;
            const subagents = m.subagents ? [...m.subagents] : [];
            const idx = subagents.findIndex((s) => s.id === payload.subagent!.id);
            if (idx >= 0) {
              subagents[idx] = payload.subagent!;
            } else {
              subagents.push(payload.subagent!);
            }
            return { ...m, subagents };
          })
        );
      } else if (payload.type === "snapshot" && payload.snapshot) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsgId ? { ...m, snapshot: payload.snapshot } : m))
        );
      } else if (payload.type === "done" || payload.type === "error") {
        unsubscribe();
        isStreamDone = true;
        // Instantly refresh tree and session files without waiting for token pacing ticker
        window.oro.getTree().then(setTree).catch(console.error);
        if (activeSession) {
          window.oro.getSessionFiles(activeSession.id).then(setSessionFiles).catch(console.error);
        }
        if (payload.type === "error") {
          finalError = payload.error || "An error occurred";
        }
        if (!streamTimerRef.current) {
          pumpStream();
        }
      }
    });

    try {
      await window.oro.sendChatMessage({
        sessionId: session.id,
        mode,
        prompt,
      });
    } catch (err) {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      setIsStreaming(false);
      unsubscribe();
    }
  };

  const handleAbort = async () => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    await window.oro.cancelChat();
    setIsStreaming(false);
  };

  const handleSummarize = async () => {
    if (!activeSession) return;
    try {
      const res = await window.oro.summarizeSession(activeSession.id);
      handleOpenFile(res.notePath);
      const taskList = await window.oro.listTasks();
      setTasks(taskList);
      const memList = await window.oro.listMemories();
      setMemories(memList);
    } catch (err) {
      console.error("Summarize error:", err);
    }
  };

  const handleRollbackSnapshot = async (snapshotId: string): Promise<boolean> => {
    try {
      // Collect messages of the rolled-back chat turn (assistant response + triggering user prompt)
      const assistantIdx = messages.findIndex((m) => m.snapshot?.id === snapshotId);
      const idsToDelete: string[] = [];
      if (assistantIdx >= 0) {
        idsToDelete.push(messages[assistantIdx]!.id);
        if (assistantIdx > 0 && messages[assistantIdx - 1]?.role === "user") {
          idsToDelete.push(messages[assistantIdx - 1]!.id);
        }
      }

      const res = await window.oro.rollbackSnapshot(snapshotId);
      if (res.success) {
        // Instant optimistic UI update: remove messages immediately (0ms delay)
        if (idsToDelete.length > 0) {
          setMessages((prev) => prev.filter((m) => !idsToDelete.includes(m.id)));
        }

        // Concurrently delete from SQLite and refresh tree / session files in the background
        Promise.all([
          idsToDelete.length > 0 ? window.oro.deleteMessages(idsToDelete) : Promise.resolve(),
          window.oro.getTree().then(setTree),
          activeSession ? window.oro.getSessionFiles(activeSession.id).then(setSessionFiles) : Promise.resolve(),
        ]).catch(console.error);

        if (activeTabPath) {
          window.oro.readFile(activeTabPath).then((fileData) => {
            setTabs((prev) =>
              prev.map((t) => (t.path === activeTabPath ? { ...t, content: fileData.content } : t))
            );
          }).catch(() => {
            handleCloseTab(activeTabPath);
          });
        }
        return true;
      }
      return false;
    } catch (e) {
      console.error("Rollback failed:", e);
      return false;
    }
  };

  // Undo conversation & workspace to this message point, roll back snapshots, delete subsequent messages, and prepopulate input
  const handleUndoToMessage = async (messageId: string): Promise<string | void> => {
    const targetIdx = messages.findIndex((m) => m.id === messageId);
    if (targetIdx === -1) return;
    const targetMsg = messages[targetIdx]!;

    let startIdx = targetIdx;
    let userPrompt = "";

    if (targetMsg.role === "assistant") {
      // If undoing an assistant message, rollback this turn and grab the user prompt that triggered it
      if (targetIdx > 0 && messages[targetIdx - 1]?.role === "user") {
        startIdx = targetIdx - 1;
        userPrompt = messages[targetIdx - 1]!.content;
      } else {
        startIdx = targetIdx;
      }
    } else if (targetMsg.role === "user") {
      // If undoing a user prompt, rollback that prompt and all subsequent messages
      startIdx = targetIdx;
      userPrompt = targetMsg.content;
    }

    const messagesToRemove = messages.slice(startIdx);
    const idsToDelete = messagesToRemove.map((m) => m.id);

    // Rollback any snapshots in reverse chronological order
    const snapshotsToRollback = messagesToRemove
      .map((m) => m.snapshot)
      .filter((s): s is NonNullable<typeof s> => Boolean(s && s.id && s.status !== "reverted"))
      .reverse();

    for (const snap of snapshotsToRollback) {
      try {
        await window.oro.rollbackSnapshot(snap.id);
      } catch (err) {
        console.warn("Rollback snapshot error:", err);
      }
    }

    // Instant optimistic UI update: remove messages immediately (0ms delay)
    setMessages((prev) => prev.filter((m) => !idsToDelete.includes(m.id)));

    // Concurrently delete from SQLite and refresh tree / session files in the background
    Promise.all([
      idsToDelete.length > 0 ? window.oro.deleteMessages(idsToDelete) : Promise.resolve(),
      window.oro.getTree().then(setTree),
      activeSession ? window.oro.getSessionFiles(activeSession.id).then(setSessionFiles) : Promise.resolve(),
    ]).catch(console.error);

    // Reload active tab if open to reflect reverted file state
    if (activeTabPath) {
      window.oro.readFile(activeTabPath).then((fileData) => {
        setTabs((prev) =>
          prev.map((t) => (t.path === activeTabPath ? { ...t, content: fileData.content } : t))
        );
      }).catch(() => {
        handleCloseTab(activeTabPath);
      });
    }

    return userPrompt;
  };

  const handleSwitchSession = async (id: string) => {
    const s = await window.oro.getSession(id);
    if (s) {
      try { localStorage.setItem("oro_active_session_id", s.id); } catch {}
      setActiveSession(s);
      setMode(s.mode);
      try {
        const [sFiles] = await Promise.all([
          window.oro.getSessionFiles(s.id),
          loadSessionMessages(s.id),
        ]);
        setSessionFiles(sFiles);
      } catch (err) {
        console.error("Failed to switch session:", err);
      }
    }
  };

  const handleNewSession = async () => {
    const nextTitle = generateNewSessionTitle(sessions);
    const created = await window.oro.createSession(nextTitle, mode);
    try { localStorage.setItem("oro_active_session_id", created.id); } catch {}
    setSessions((prev) => [...prev, created]);
    setActiveSession(created);
    setMessages([]);
    setSessionFiles([]);
  };

  const handleRenameSession = async (id: string, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      await window.oro.updateSession(id, { title: trimmed });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s))
      );
      if (activeSession?.id === id) {
        setActiveSession((prev) => (prev ? { ...prev, title: trimmed } : null));
      }
    } catch (err) {
      console.error("Rename session error:", err);
    }
  };

  const handleCloseSession = async (id: string) => {
    // 1. Instant optimistic UI update (0ms delay)
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (activeSession?.id === id) {
      if (remaining.length > 0) {
        handleSwitchSession(remaining[0]!.id);
      } else {
        handleNewSession();
      }
    }

    // 2. Perform DB deletion non-blocking in background
    window.oro.deleteSession(id).catch((err) => {
      console.error("Close session error:", err);
    });
  };

  // Optimistic file/folder deletion with 0ms UI delay
  const handleDeletePath = async (relPath: string) => {
    // 1. Close any open tabs matching relPath or relPath/ immediately
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== relPath && !t.path.startsWith(`${relPath}/`));
      if (next.length === 0) {
        setActiveTabPath(null);
        setEditorOpen(false);
      } else if (activeTabPath === relPath || (activeTabPath && activeTabPath.startsWith(`${relPath}/`))) {
        setActiveTabPath(next[next.length - 1]!.path);
      }
      return next;
    });

    // 2. Optimistically remove from file tree immediately (0ms)
    const filterTree = (nodes: TreeNode[]): TreeNode[] => {
      return nodes
        .filter((n) => n.path !== relPath && !n.path.startsWith(`${relPath}/`))
        .map((n) => (n.children ? { ...n, children: filterTree(n.children) } : n));
    };
    setTree((prev) => filterTree(prev));

    // 3. Perform backend deletion and sync
    try {
      await window.oro.deletePath(relPath);
      const [treeData, wsInfo] = await Promise.all([
        window.oro.getTree(),
        window.oro.getWorkspaceInfo(),
      ]);
      setTree(treeData);
      setWorkspace(wsInfo);
      if (activeSession) {
        const sFiles = await window.oro.getSessionFiles(activeSession.id);
        setSessionFiles(sFiles);
      }
    } catch (err) {
      console.error("Delete path failed:", err);
      const treeData = await window.oro.getTree();
      setTree(treeData);
    }
  };

  const handleTogglePin = async (relPath: string) => {
    if (!activeSession) return;
    const cur = sessionFiles.find((f) => f.path === relPath);
    const nextPinned = !(cur?.pinned ?? false);
    await window.oro.setFilePinned(activeSession.id, relPath, nextPinned);
    const sFiles = await window.oro.getSessionFiles(activeSession.id);
    setSessionFiles(sFiles);
  };

  const handleToggleTask = async (id: number) => {
    await window.oro.toggleTask(id);
    const taskList = await window.oro.listTasks();
    setTasks(taskList);
  };

  const handleNewFileSubmit = async (name: string) => {
    let clean = name.trim().replace(/\\/g, "/");
    if (!clean) return;
    if (!clean.includes(".")) clean += ".md";
    const baseName = clean.split("/").pop()?.replace(/\.md$/i, "") || "Untitled";
    const content = clean.endsWith(".md")
      ? `---\ntitle: "${baseName}"\ndate: ${new Date().toISOString().slice(0, 10)}\ntags: []\n---\n\n# ${baseName}\n\n`
      : "";
    try {
      await window.oro.writeFile(clean, content);
      const treeData = await window.oro.getTree();
      setTree(treeData);
      await handleOpenFile(clean);
    } catch (err) {
      console.error("New note error:", err);
      alert(`Could not create note: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleNewFolderSubmit = async (name: string) => {
    const clean = name.trim().replace(/\\/g, "/");
    if (!clean) return;
    try {
      await window.oro.createFolder(clean);
      const treeData = await window.oro.getTree();
      setTree(treeData);
    } catch (err) {
      console.error("New folder error:", err);
      alert(`Could not create folder: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleReindex = async () => {
    if (isReindexing) return;
    setIsReindexing(true);
    try {
      // 1. Immediately load fresh files and folders from disk so new files show up in <10ms
      const [treeData, wsInfo] = await Promise.all([
        window.oro.getTree(),
        window.oro.getWorkspaceInfo(),
      ]);
      setTree(treeData);
      setWorkspace(wsInfo);

      // 2. Run fast incremental reindexing in background
      await window.oro.reindex();
    } catch (err) {
      console.error("Reindex error:", err);
    } finally {
      setIsReindexing(false);
    }
  };

  const handleSwitchWorkspace = async (folderPath: string, options?: { seedStarter?: boolean }) => {
    try {
      const info = await window.oro.switchWorkspace(folderPath, options);
      setWorkspace(info);
      setTabs([]);
      setActiveTabPath(null);
      setMessages([]);
      setSessionFiles([]);
      setIsStreaming(false);

      if (options?.seedStarter === false) {
        // Create New Workspace: start with a fresh chat session
        const created = await window.oro.createSession("New Session", mode);
        try {
          localStorage.setItem("oro_active_session_id", created.id);
        } catch {}
        setActiveSession(created);
      } else {
        // Open Existing / Recent Workspace: load its existing sessions & chat
        try {
          localStorage.removeItem("oro_active_session_id");
        } catch {}
      }

      await reloadWorkspace();
    } catch (err) {
      console.error("Failed to switch workspace:", err);
      alert(`Could not switch workspace: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="app-container">
      {/* 1. Full-width Titlebar across entire 100vw, background: var(--bg-canvas), borderless */}
      <TitleBar
        workspace={workspace}
        session={activeSession}
        sessions={sessions}
        mode={mode}
        config={config}
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        activeFilePath={activeTabPath}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenWorkspacePicker={() => setActiveModal("workspace")}
        onNewWorkspace={() => setActiveModal("workspace_create")}
        onSwitchWorkspace={handleSwitchWorkspace}
        onConfigureSession={(s) => {
          setSessionToConfigure(s);
          setActiveModal("session_config");
        }}
        isEditorOpen={editorOpen}
        onToggleEditor={() => setEditorOpen((prev) => !prev)}
        onSwitchSession={handleSwitchSession}
        onNewSession={handleNewSession}
        onCloseSession={handleCloseSession}
        onRenameSession={handleRenameSession}
        onDistill={handleSummarize}
        onOpenModelModal={() => setActiveModal("settings")}
        onOpenSettings={() => setActiveModal("settings")}
        onOpenCommandPalette={() => setQuickSwitcherOpen(true)}
        onNewFile={() => setActiveModal("new_file")}
        onNewFolder={() => setActiveModal("new_folder")}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        hasDiff={Boolean(tabs.find((t) => t.path === activeTabPath)?.originalContent)}
        isReindexing={isReindexing}
        onReindex={handleReindex}
      />

      {/* 2. Main Viewport: Seamless L-shaped canvas docking Sidebar and Floating Cards */}
      <div
        className="main-viewport"
        style={{
          flex: 1,
          minHeight: 0,
          padding: "0 6px 6px 6px",
          display: "flex",
          gap: 6,
          overflow: "hidden",
          position: "relative",
          background: "var(--bg-canvas)",
        }}
      >
        {/* Floating Zen Mode Exit Pill */}
        {zenMode === "editor" && (
          <button
            onClick={() => setZenMode("none")}
            className="unified-btn"
            style={{
              position: "absolute",
              top: 10,
              right: 18,
              zIndex: 100,
              background: "var(--modal-bg)",
              backdropFilter: "blur(12px)",
              border: "1px solid var(--border)",
              borderRadius: 9999,
              padding: "4px 12px",
              fontSize: 11,
              color: "var(--text)",
              boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
            }}
            title="Exit Zen Mode (Esc or Ctrl+Shift+Z)"
          >
            <span>✕ Exit Zen</span>
          </button>
        )}

        {/* Left: Auto-Hiding Interactive Second-Brain Sidebar */}
        {sidebarOpen && zenMode !== "editor" && (
          <div
            style={{
              width: sidebarWidth,
              maxWidth: "35vw",
              minWidth: 180,
              height: "100%",
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              background: "var(--bg-canvas)",
              border: "none",
              overflow: "hidden",
            }}
          >
            <SidebarDrawer
              tree={tree}
              tasks={tasks}
              memories={memories}
              workspace={workspace}
              workspaceRoot={workspace?.root}
              activeFilePath={activeTabPath}
              onToggleSidebar={() => setSidebarOpen((v) => !v)}
              onOpenWorkspacePicker={() => setActiveModal("workspace")}
              onNewWorkspace={() => setActiveModal("workspace_create")}
              onPreviewFile={handlePreviewFile}
              onOpenFile={handleOpenFile}
              onMovePath={handleMovePath}
              onToggleTask={handleToggleTask}
              onNewFile={() => setActiveModal("new_file")}
              onNewFolder={() => setActiveModal("new_folder")}
              isReindexing={isReindexing}
              onReindex={handleReindex}
              onDeletePath={handleDeletePath}
            />
          </div>
        )}

        {/* Resizer 1: Border between Sidebar and Chat Card */}
        {sidebarOpen && zenMode !== "editor" && (
          <SplitResizer onDrag={handleSidebarResize} style={{ margin: "0 -2px" }} />
        )}

        {/* Center: Cursor-style AI Agent Chat with Floating Editor overlay when chose */}
        {zenMode !== "editor" && (
          <div
            className="chat-column"
            style={{
              flex: editorOpen && editorDockMode === "split" ? "none" : 1,
              width: editorOpen && editorDockMode === "split" ? chatWidth : "auto",
              maxWidth: editorOpen && editorDockMode === "split"
                ? (sidebarOpen ? "calc(100vw - 380px)" : "calc(100vw - 220px)")
                : "100%",
              minWidth: 0,
              height: "100%",
              flexShrink: editorOpen && editorDockMode === "split" ? 0 : 1,
              flexGrow: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRadius: 12,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              position: "relative",
            }}
          >
            {recoverableDrafts.length > 0 && (
              <div
                style={{
                  margin: "8px 12px 0 12px",
                  padding: "7px 12px",
                  borderRadius: 8,
                  background: "rgba(245, 158, 11, 0.10)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 11.5,
                  color: "var(--text)",
                  gap: 12,
                  zIndex: 25,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: 13 }}>💾</span>
                  <span>
                    <strong>Unsaved draft recovered</strong> ({recoverableDrafts.map((d) => d.path).join(", ")}) from previous session.
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    className="unified-btn"
                    onClick={async () => {
                      for (const d of recoverableDrafts) {
                        await handleOpenFile(d.path);
                        handleUpdateContent(d.path, d.content);
                      }
                      setRecoverableDrafts([]);
                    }}
                    style={{
                      fontSize: 11,
                      height: 24,
                      padding: "0 9px",
                      borderRadius: 9999,
                      color: "#f59e0b",
                      border: "1px solid rgba(245, 158, 11, 0.45)",
                    }}
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    className="unified-btn"
                    onClick={async () => {
                      await window.oro.clearAllDrafts().catch(() => {});
                      setRecoverableDrafts([]);
                    }}
                    style={{
                      fontSize: 11,
                      height: 24,
                      padding: "0 8px",
                      borderRadius: 9999,
                      color: "var(--text-subtle)",
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            <ChatPanel
              messages={messages}
              sessionFiles={sessionFiles}
              isStreaming={isStreaming}
              activeMode={mode}
              decidedMode={decidedMode}
              activeFilePath={activeTabPath}
              config={config}
              onChangeModel={handleModelChange}
              onSendMessage={handleSendMessage}
              onAbort={handleAbort}
              onOpenFile={handleOpenFile}
              onFollowWikiLink={(p) => {
                handleFollowWikiLink(p);
                setEditorOpen(true);
              }}
              onTogglePin={handleTogglePin}
              onSummarize={handleSummarize}
              onNewSession={handleNewSession}
              isEditorFloatingOpen={editorOpen && editorDockMode === "floating"}
              floatingEditorWidth={floatingEditorWidth}
              activeSession={activeSession}
              onRenameSession={handleRenameSession}
              onCloseSession={handleCloseSession}
              onOpenSettings={() => setActiveModal("settings")}
              editorDockMode={editorDockMode}
              onToggleDockMode={handleToggleEditorDockMode}
              isEditorOpen={editorOpen}
              onToggleEditor={() => setEditorOpen((prev) => !prev)}
              onRollbackSnapshot={handleRollbackSnapshot}
              onUndoToMessage={handleUndoToMessage}
              onChangeMode={(m) => {
                setMode(m);
                if (activeSession) window.oro.updateSession(activeSession.id, { mode: m });
              }}
            />

            {/* Floating Editor and Preview Window on the right side of the chat */}
            {editorOpen && editorDockMode === "floating" && (
              <div
                className="floating-editor-window"
                style={{
                  width: isFloatingExpanded ? "min(70%, calc(100% - 220px))" : floatingEditorWidth,
                  maxWidth: "calc(100% - 24px)",
                  minWidth: 300,
                  right: 8,
                }}
              >
                {/* Left-edge draggable resize handle */}
                <SplitResizer
                  onDrag={handleFloatingEditorResize}
                  onDoubleClick={() => setIsFloatingExpanded((prev) => !prev)}
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 5,
                    zIndex: 35,
                  }}
                />
                <EditorPanel
                  tabs={tabs}
                  activePath={activeTabPath}
                  tree={tree}
                  viewMode={viewMode}
                  onChangeViewMode={setViewMode}
                  onSelectTab={(p) => {
                    setActiveTabPath(p);
                    setEditorOpen(true);
                  }}
                  onPinTab={handlePinTab}
                  onCloseTab={handleCloseTab}
                  onCloseOtherTabs={handleCloseOtherTabs}
                  onCloseTabsToRight={handleCloseTabsToRight}
                  onUpdateContent={handleUpdateContent}
                  onSaveFile={handleSaveFile}
                  onOpenExternal={(p) => window.oro.openExternal(p)}
                  onFollowWikiLink={(p) => {
                    handleFollowWikiLink(p);
                    setEditorOpen(true);
                  }}
                  editorConfig={config?.editor}
                  onClosePanel={() => setEditorOpen(false)}
                  dockMode="floating"
                  isExpanded={isFloatingExpanded}
                  onToggleExpand={() => setIsFloatingExpanded((prev) => !prev)}
                  onToggleDockMode={handleToggleEditorDockMode}
                />
              </div>
            )}
          </div>
        )}

        {/* Resizer 2: Border between Chat and Editor (only active in docked split mode) */}
        {editorOpen && editorDockMode === "split" && zenMode !== "editor" && (
          <SplitResizer
            onDrag={handleChatResize}
            style={{ margin: "0 -2px" }}
            onDoubleClick={() => setZenMode((cur) => (cur === "editor" ? "none" : "editor"))}
          />
        )}

        {/* Right: Docked Multi-Tab Editor & Workspace (only active in docked split mode) */}
        {editorOpen && editorDockMode === "split" && (
          <div
            className="workspace-column"
            style={{
              flex: 1,
              minWidth: zenMode === "editor" ? "100%" : 200,
              height: "100%",
              display: "flex",
              overflow: "hidden",
              borderRadius: 12,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
            }}
          >
            <EditorPanel
              tabs={tabs}
              activePath={activeTabPath}
              tree={tree}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              onSelectTab={(p) => {
                setActiveTabPath(p);
                setEditorOpen(true);
              }}
              onPinTab={handlePinTab}
              onCloseTab={handleCloseTab}
              onCloseOtherTabs={handleCloseOtherTabs}
              onCloseTabsToRight={handleCloseTabsToRight}
              onUpdateContent={handleUpdateContent}
              onSaveFile={handleSaveFile}
              onOpenExternal={(p) => window.oro.openExternal(p)}
              onFollowWikiLink={(p) => {
                handleFollowWikiLink(p);
                setEditorOpen(true);
              }}
              editorConfig={config?.editor}
              onClosePanel={() => setEditorOpen(false)}
              dockMode="split"
              onToggleDockMode={handleToggleEditorDockMode}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {activeModal === "settings" && config && (
        <SettingsModal
          config={config}
          workspace={workspace}
          onClose={() => setActiveModal(null)}
          onConfigUpdated={(updatedCfg) => setConfig(updatedCfg)}
          onSwitchWorkspace={handleSwitchWorkspace}
        />
      )}

      {(activeModal === "workspace" || activeModal === "workspace_create") && workspace && (
        <WorkspaceModal
          currentRoot={workspace.root}
          onClose={() => setActiveModal(null)}
          onSwitch={handleSwitchWorkspace}
          initialTab={activeModal === "workspace_create" ? "create" : "open"}
        />
      )}

      {activeModal === "new_file" && (
        <PromptModal
          type="file"
          onClose={() => setActiveModal(null)}
          onSubmit={handleNewFileSubmit}
        />
      )}

      {activeModal === "new_folder" && (
        <PromptModal
          type="folder"
          onClose={() => setActiveModal(null)}
          onSubmit={handleNewFolderSubmit}
        />
      )}

      {activeModal === "session_config" && sessionToConfigure && (
        <SessionConfigModal
          session={sessionToConfigure}
          onClose={() => {
            setActiveModal(null);
            setSessionToConfigure(null);
          }}
          onSave={async (sessionId, patch) => {
            await window.oro.updateSession(sessionId, patch);
            setSessions((prev) =>
              prev.map((s) => (s.id === sessionId ? { ...s, ...patch } : s))
            );
            if (activeSession && activeSession.id === sessionId) {
              setActiveSession((prev) => (prev ? { ...prev, ...patch } : null));
              if (patch.mode) setMode(patch.mode);
            }
          }}
          onDelete={handleCloseSession}
        />
      )}
      {/* Universal Command Palette (Ctrl+K / Ctrl+P) */}
      {quickSwitcherOpen && (
        <QuickSwitcherModal
          sessions={sessions}
          activeSessionId={activeSession?.id || null}
          tree={tree}
          onOpenFile={handleOpenFile}
          onSwitchSession={handleSwitchSession}
          onClose={() => setQuickSwitcherOpen(false)}
          onNewSession={handleNewSession}
          onToggleTheme={handleToggleTheme}
          onOpenSettings={() => setActiveModal("settings")}
          onSelectMode={(m) => setMode(m)}
          onDistill={handleSummarize}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleZen={() => setZenMode((z) => (z === "editor" ? "none" : "editor"))}
          onOpenExternal={activeTabPath ? () => window.oro.openExternal(activeTabPath) : undefined}
          onSwitchWorkspace={() => setActiveModal("workspace")}
          onNewWorkspace={() => setActiveModal("workspace_create")}
          currentTheme={currentTheme}
        />
      )}

      {showSplash && (
        <SplashScreen
          isReady={isAppReady}
          onFinished={() => setShowSplash(false)}
        />
      )}
    </div>
  );
};
