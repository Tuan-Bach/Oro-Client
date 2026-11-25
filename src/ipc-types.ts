import type {
  AgentModeId,
  BacklinkInfo,
  NoteLinkRecord,
  OroConfig,
  ProviderId,
  ChatMessageRecord,
  SessionFileRecord,
  SessionRecord,
  SubagentProgressEvent,
  TaskRecord,
  MemoryRecord,
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
} from "./types.js";

export interface WorkspaceSummary {
  root: string;
  name: string;
  stats: {
    notes: number;
    links: number;
    brokenLinks: number;
    tags: number;
    memories: number;
    openTasks: number;
  };
}

export interface StreamEventPayload {
  type: "text" | "tool_call" | "tool_result" | "done" | "error" | "mode_decided" | "phase_changed" | "verification" | "subagent" | "session_renamed" | "snapshot";
  title?: string;
  mode?: "plan" | "builder" | "triad";
  phase?: "architect" | "builder" | "critic" | "done";
  phaseDetail?: string;
  verification?: {
    passed: boolean;
    message: string;
    attempt: number;
  };
  subagent?: SubagentProgressEvent;
  snapshot?: TurnSnapshotRecord;
  textDelta?: string;
  toolCall?: {
    id: string;
    name: string;
    args: Record<string, unknown>;
  };
  toolResult?: {
    id: string;
    name: string;
    summary: string;
    ok: boolean;
    output?: string;
  };
  error?: string;
}

export interface OroDesktopApi {
  getWorkspaceInfo: () => Promise<WorkspaceSummary>;
  selectWorkspaceFolder: () => Promise<string | null>;
  switchWorkspace: (folderPath: string, options?: { seedStarter?: boolean }) => Promise<WorkspaceSummary>;
  getRecentWorkspaces: () => Promise<Array<{ path: string; name: string; lastOpenedAt: string }>>;

  getTree: (subPath?: string) => Promise<TreeNode[]>;
  readFile: (relPath: string) => Promise<{ path: string; content: string; totalLines: number }>;
  writeFile: (relPath: string, content: string, encoding?: "utf8" | "base64") => Promise<{ path: string; action: string; bytes: number }>;
  deletePath: (relPath: string) => Promise<{ path: string; trashPath: string }>;
  movePath: (from: string, to: string) => Promise<{ from: string; to: string; updatedLinksIn: string[] }>;
  createFolder: (relPath: string) => Promise<{ path: string; created: boolean }>;
  reindex: () => Promise<{ reindexed: boolean; stats: any }>;
  openExternal: (relPath?: string) => Promise<string>;
  revealInExplorer: (relPath?: string) => Promise<{ success: boolean; path: string }>;

  getBacklinks: (relPath: string) => Promise<{
    outgoing: NoteLinkRecord[];
    backlinks: BacklinkInfo[];
    tags: string[];
  }>;
  getAllLinks: () => Promise<NoteLinkRecord[]>;
  searchVault: (query: string) => Promise<VaultSearchHit[]>;

  listSessions: () => Promise<SessionRecord[]>;
  getSession: (id: string) => Promise<SessionRecord | null>;
  createSession: (title?: string, mode?: AgentModeId) => Promise<SessionRecord>;
  updateSession: (id: string, patch: Partial<{ title: string; mode: AgentModeId }>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  listMessages: (sessionId: string) => Promise<ChatMessageRecord[]>;
  deleteMessages: (ids: string[]) => Promise<void>;
  getSessionFiles: (sessionId: string) => Promise<SessionFileRecord[]>;
  setFilePinned: (sessionId: string, relPath: string, pinned: boolean) => Promise<void>;

  listMemories: (query?: string) => Promise<MemoryRecord[]>;
  saveMemory: (content: string, category?: string) => Promise<MemoryRecord>;
  listTasks: () => Promise<TaskRecord[]>;
  toggleTask: (id: number, done?: boolean) => Promise<TaskRecord | null>;
  addTask: (title: string, filePath?: string) => Promise<TaskRecord>;

  getConfig: () => Promise<OroConfig>;
  saveConfig: (patch: Partial<OroConfig>) => Promise<OroConfig>;
  saveDefaultBrain: (vaultPath: string) => Promise<void>;
  fetchOllamaModels: (baseUrl?: string) => Promise<string[]>;
  fetchProviderModels: (
    provider: ProviderId,
    apiKey?: string,
    baseUrl?: string
  ) => Promise<Array<{ id: string; name: string; tag?: string }>>;
  saveProviderKey: (provider: ProviderId, apiKey: string) => Promise<void>;
  saveProviderModel: (
    provider: ProviderId,
    model: string,
    baseUrl?: string,
    reasoningEffort?: "low" | "medium" | "high"
  ) => Promise<void>;

  sendChatMessage: (opts: {
    sessionId: string;
    mode: AgentModeId;
    prompt: string;
  }) => Promise<void>;
  cancelChat: () => Promise<void>;
  onChatStream: (callback: (payload: StreamEventPayload) => void) => () => void;

  summarizeSession: (sessionId: string) => Promise<{
    summary: string;
    memoriesAdded: number;
    tasksAdded: number;
    notePath: string;
  }>;

  listSnapshots: (sessionId: string) => Promise<TurnSnapshotRecord[]>;
  rollbackSnapshot: (snapshotId: string) => Promise<RollbackResult>;

  listDrafts: () => Promise<EditorDraftRecord[]>;
  saveDraft: (path: string, content: string) => Promise<void>;
  deleteDraft: (path: string) => Promise<void>;
  clearAllDrafts: () => Promise<void>;

  windowControl: (action: "minimize" | "maximize" | "close") => Promise<void>;
  setZoomFactor?: (factor: number) => Promise<void>;

  // 24/7 Co-Worker Tauri / REST IPC
  getShiftStatus?: () => Promise<ShiftStatus>;
  setShiftStatus?: (status: ShiftStatus) => Promise<ShiftStatus>;
  createCoworkerGoal?: (title: string, description?: string, tokenBudget?: number) => Promise<CoworkerGoal>;
  getActiveCoworkerGoal?: () => Promise<CoworkerGoal | null>;
  createCoworkerTask?: (goalId: string, title: string, role: string, modelTier: string, dependencies: string[]) => Promise<CoworkerTask>;
  listCoworkerTasks?: (goalId: string) => Promise<CoworkerTask[]>;
  listCoworkerApprovals?: (goalId?: string) => Promise<CoworkerApproval[]>;
  resolveCoworkerApproval?: (id: string, approved: boolean, note?: string) => Promise<string[]>;
  getCoworkerSnapshot?: () => Promise<CoworkerSnapshot>;
}

// Backward-compatible alias
export type OroElectronApi = OroDesktopApi;
