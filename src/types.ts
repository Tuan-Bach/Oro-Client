export type ProviderId = "gemini" | "openai" | "anthropic" | "ollama";

export type AgentModeId = "default" | "auto" | "plan" | "builder" | "triad" | "assistant" | "organizer" | "researcher";

export type FileAction = "read" | "created" | "modified" | "moved" | "deleted" | "pinned";

export type ReasoningEffort = "low" | "medium" | "high";

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
}

export interface EditorPreferences {
  fontSize?: number;
  fontFamily?: string;
  fontPreset?: "sans" | "mono" | "serif";
  wordWrap?: "on" | "off";
  minimap?: boolean;
  lineNumbers?: "on" | "off";
  defaultView?: "split" | "editor" | "preview";
}

export interface UIPreferences {
  theme?: "dark" | "light" | "monokai";
  systemFont?: string;
  systemFontSize?: number;
  systemScale?: number;
}

export interface OroConfig {
  provider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  defaultMode: AgentModeId;
  maxAgentSteps: number;
  autoIndex: boolean;
  userInstructions?: string;
  editor?: EditorPreferences;
  defaultVaultPath?: string;
  ui?: UIPreferences;
  safetyLevel?: "autonomous" | "confirm_destructive" | "strict";
}

export interface SessionRecord {
  id: string;
  title: string;
  mode: AgentModeId;
  provider: ProviderId;
  model: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionFileRecord {
  sessionId: string;
  path: string; // normalized workspace-relative posix path
  lastAction: FileAction;
  pinned: boolean;
  touchCount: number;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string | null;
  toolCallId?: string | null;
  toolArgs?: string | null;
  snapshotId?: string | null;
  createdAt: string;
}

export interface NoteRecord {
  path: string; // relative posix path
  title: string;
  content: string;
  frontmatterJson: string;
  mtimeMs: number;
  sizeBytes: number;
  wordCount: number;
  updatedAt: string;
}

export interface NoteLinkRecord {
  sourcePath: string;
  targetRaw: string;
  targetResolved: string | null;
  alias: string | null;
}

export interface BacklinkInfo {
  sourcePath: string;
  sourceTitle: string;
  alias: string | null;
}

export interface VaultSearchHit {
  path: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface MemoryRecord {
  id: number;
  category: "fact" | "preference" | "decision" | "project" | "summary";
  content: string;
  tags: string[];
  importance: number; // 1..5
  sourceSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: number;
  title: string;
  done: boolean;
  filePath: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreeNode {
  name: string;
  path: string; // relative posix path
  isDir: boolean;
  depth: number;
  expanded?: boolean;
  children?: TreeNode[];
  sizeBytes?: number;
}

export interface ParsedMarkdown {
  title: string;
  frontmatter: Record<string, unknown>;
  links: Array<{ raw: string; target: string; alias: string | null }>;
  tags: string[];
  headings: Array<{ level: number; text: string }>;
  tasks: Array<{ done: boolean; text: string; line: number }>;
  wordCount: number;
}

export interface SubagentProgressEvent {
  id: string;
  role: string;
  task: string;
  modelTier?: "fast" | "standard" | "reasoning";
  status: "running" | "done" | "error";
  summary?: string;
  findings?: string;
}

export interface ToolCallEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  summary?: string;
  output?: string;
}

export interface SnapshotManifestItem {
  path: string;
  originalExists: boolean;
  action: "created" | "modified" | "moved" | "deleted";
  originalPath?: string;
  backupRelPath?: string;
  bytes?: number;
}

export interface TurnSnapshotRecord {
  id: string;
  sessionId: string;
  turnIndex: number;
  userPrompt: string;
  createdAt: string;
  status: "active" | "reverted";
  manifest: SnapshotManifestItem[];
}

export interface RollbackResult {
  success: boolean;
  snapshotId: string;
  restoredFiles: string[];
  deletedFiles: string[];
  error?: string;
}

export interface UIMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallEvent[];
  subagents?: SubagentProgressEvent[];
  snapshot?: TurnSnapshotRecord;
  createdAt: string;
  streaming?: boolean;
}

export interface EditorDraftRecord {
  path: string;
  content: string;
  updatedAt: string;
}

export type ShiftStatus = "at_desk" | "stepping_away" | "draining";

export interface CoworkerGoal {
  id: string;
  title: string;
  description?: string | null;
  status: "active" | "completed" | "paused" | "failed";
  createdAt: number;
  completedAt?: number | null;
  tokenBudget: number;
  tokensUsed: number;
}

export interface CoworkerTask {
  id: string;
  goalId: string;
  title: string;
  role: "Scout" | "Coder" | "Tester" | "Critic" | string;
  modelTier: "fast" | "standard" | "reasoning" | string;
  status: "pending" | "in_progress" | "waiting_approval" | "done" | "failed" | "skipped";
  dependencies: string[];
  checkpointContext?: string | null;
  resultSummary?: string | null;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

export interface CoworkerApproval {
  id: string;
  taskId: string;
  goalId: string;
  actionType: "shell_exec" | "delete_file" | "git_push" | "destructive_edit" | string;
  title: string;
  payloadJson: string;
  status: "pending" | "approved" | "rejected";
  userResponseNote?: string | null;
  createdAt: number;
  resolvedAt?: number | null;
}

export interface CoworkerSnapshot {
  shift: ShiftStatus;
  activeTaskId: string | null;
  pendingTasksCount: number;
  waitingApprovalsCount: number;
  completedTasksCount: number;
  totalTasksCount: number;
}
