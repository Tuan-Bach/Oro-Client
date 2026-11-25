import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  Send,
  Square,
  Sparkles,
  Bot,
  User,
  FileText,
  Terminal,
  RotateCcw,
  Sliders,
  ChevronDown,
  ChevronRight,
  Check,
  Plus,
  ArrowUp,
  Paperclip,
  Image as ImageIcon,
  X,
  MoreVertical,
  Edit3,
  Pin,
  Archive,
  Columns,
  Copy,
  Settings,
  Undo2,
  FolderTree,
  FileCode,
  Search,
  Trash2,
  FolderPlus,
  Loader2,
  AlertCircle,
  ArrowDown,
} from "lucide-react";
import { marked } from "marked";
import type { AgentModeId, OroConfig, ProviderId, SessionFileRecord, SessionRecord, ToolCallEvent, SubagentProgressEvent } from "../../types.js";
import { processDroppedFiles, processDroppedDataTransfer, formatFileSize, type DroppedFileInfo } from "../utils/fileDropHelper.js";
import { ContextMenu } from "./ContextMenu.js";
import { appPrompt } from "./AppDialog.js";

const PROVIDER_MODELS: Record<
  ProviderId,
  { label: string; models: Array<{ id: string; name: string; tag: string }> }
> = {
  gemini: {
    label: "Google Gemini",
    models: [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", tag: "Fast" },
      { id: "gemini-flash-latest", name: "Gemini Flash Latest", tag: "Fast" },
      { id: "gemini-pro-latest", name: "Gemini Pro Latest", tag: "Reasoning" },
      { id: "gemini-flash-lite-latest", name: "Gemini Flash-Lite Latest", tag: "Ultra-Fast" },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", tag: "Fast" },
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", tag: "Ultra-Fast" },
    ],
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o mini", tag: "Fast" },
      { id: "gpt-4o", name: "GPT-4o", tag: "Smart" },
      { id: "o3-mini", name: "o3-mini", tag: "Reasoning" },
      { id: "o1", name: "o1", tag: "Reasoning" },
    ],
  },
  anthropic: {
    label: "Anthropic Claude",
    models: [
      { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet", tag: "Smart" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", tag: "Smart" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", tag: "Fast" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tag: "Reasoning" },
    ],
  },
  ollama: {
    label: "Ollama (Local)",
    models: [
      { id: "llama3.2", name: "Llama 3.2", tag: "Local" },
      { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder", tag: "Coding" },
      { id: "deepseek-r1:8b", name: "DeepSeek R1", tag: "Reasoning" },
      { id: "mistral", name: "Mistral", tag: "Local" },
    ],
  },
};

export interface ChatMessageUI {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCallEvent[];
  subagents?: SubagentProgressEvent[];
  streaming?: boolean;
  snapshot?: import("../../types.js").TurnSnapshotRecord;
}

function getToolMeta(name: string, args?: Record<string, unknown>) {
  switch (name) {
    case "list_files": {
      const p = args?.path ? String(args.path) : ".";
      return {
        title: `List Files`,
        subtitle: p === "." ? "workspace" : p,
        icon: <FolderTree size={12} style={{ color: "var(--cyan)" }} />,
        badge: "Explore",
      };
    }
    case "read_file": {
      const p = args?.path ? String(args.path) : "file";
      const lines = args?.startLine || args?.start_line ? ` (L${args.startLine || args.start_line}..)` : "";
      return {
        title: `Read File`,
        subtitle: `${p}${lines}`,
        icon: <FileText size={12} style={{ color: "var(--cyan)" }} />,
        badge: "Inspect",
      };
    }
    case "write_file": {
      const p = args?.path ? String(args.path) : "file";
      return {
        title: `Write File`,
        subtitle: p,
        icon: <FileCode size={12} style={{ color: "var(--green)" }} />,
        badge: "Create",
      };
    }
    case "edit_file": {
      const p = args?.path ? String(args.path) : "file";
      return {
        title: `Edit File`,
        subtitle: p,
        icon: <Edit3 size={12} style={{ color: "var(--amber, #f59e0b)" }} />,
        badge: "Diff",
      };
    }
    case "create_folder": {
      const p = args?.path ? String(args.path) : "folder";
      return {
        title: `Create Folder`,
        subtitle: p,
        icon: <FolderPlus size={12} style={{ color: "var(--cyan)" }} />,
        badge: "Folder",
      };
    }
    case "delete_path": {
      const p = args?.path ? String(args.path) : "path";
      return {
        title: `Delete Path`,
        subtitle: p,
        icon: <Trash2 size={12} style={{ color: "var(--red)" }} />,
        badge: "Trash",
      };
    }
    case "search_vault": {
      const q = args?.query ? `"${args.query}"` : "";
      return {
        title: `Search Vault`,
        subtitle: q,
        icon: <Search size={12} style={{ color: "var(--cyan)" }} />,
        badge: "Search",
      };
    }
    case "get_backlinks": {
      const p = args?.path ? String(args.path) : "note";
      return {
        title: `Note Links`,
        subtitle: p,
        icon: <Sparkles size={12} style={{ color: "var(--purple, #a855f7)" }} />,
        badge: "Graph",
      };
    }
    case "execute_command": {
      const cmd = args?.command ? String(args.command) : "command";
      return {
        title: `Run Terminal`,
        subtitle: cmd,
        icon: <Terminal size={12} style={{ color: "var(--purple, #a855f7)" }} />,
        badge: "Shell",
      };
    }
    default:
      return {
        title: name,
        subtitle: "",
        icon: <Sparkles size={12} style={{ color: "var(--cyan)" }} />,
        badge: "Tool",
      };
  }
}

const ToolCallsAccordion: React.FC<{
  toolCalls: ToolCallEvent[];
  onOpenFile: (path: string) => void;
}> = ({ toolCalls, onOpenFile }) => {
  const isRunning = toolCalls.some((tc) => tc.status === "running");
  const [isOpen, setIsOpen] = useState(isRunning);
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(() => new Set());
  const hasError = toolCalls.some((tc) => tc.status === "error");

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedCalls((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toolSummaries = useMemo(() => {
    const names = Array.from(new Set(toolCalls.map((t) => t.name)));
    return names.join(", ");
  }, [toolCalls]);

  return (
    <div
      style={{
        marginBottom: 8,
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        background: "var(--card-bg, rgba(255, 255, 255, 0.02))",
        overflow: "hidden",
        fontSize: 11.5,
      }}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          cursor: "pointer",
          userSelect: "none",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {isRunning ? (
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--cyan)",
                boxShadow: "0 0 8px var(--cyan)",
                flexShrink: 0,
              }}
            />
          ) : hasError ? (
            <AlertCircle size={12} style={{ color: "var(--red)", flexShrink: 0 }} />
          ) : (
            <Check size={12} strokeWidth={2.5} style={{ color: "var(--green)", flexShrink: 0 }} />
          )}

          <span
            style={{
              fontWeight: 550,
              color: isRunning ? "var(--cyan)" : "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {isRunning
              ? `Executing ${toolCalls.length} tool action${toolCalls.length > 1 ? "s" : ""} (${toolSummaries})…`
              : `Completed ${toolCalls.length} tool action${toolCalls.length > 1 ? "s" : ""}`}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-subtle)", flexShrink: 0 }}>
          <span style={{ fontSize: 10 }}>{isOpen ? "Hide" : "Details"}</span>
          {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </div>
      </div>

      {isOpen && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 5,
            padding: "4px 8px 8px",
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          {toolCalls.map((tc) => {
            const meta = getToolMeta(tc.name, tc.args);
            const isCallExpanded = expandedCalls.has(tc.id);
            const pathArg = tc.args?.path ? String(tc.args.path) : null;

            return (
              <div
                key={tc.id}
                style={{
                  background: "var(--hover-overlay)",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                  overflow: "hidden",
                }}
              >
                {/* Single tool action header */}
                <div
                  onClick={(e) => toggleExpand(tc.id, e)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  {/* Status icon */}
                  {tc.status === "running" ? (
                    <Loader2 size={11} className="spin" style={{ color: "var(--cyan)", flexShrink: 0 }} />
                  ) : tc.status === "done" ? (
                    <Check size={11} strokeWidth={2.5} style={{ color: "var(--green)", flexShrink: 0 }} />
                  ) : (
                    <AlertCircle size={11} style={{ color: "var(--red)", flexShrink: 0 }} />
                  )}

                  {/* Tool icon */}
                  <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                    {meta.icon}
                  </span>

                  {/* Human-friendly action title */}
                  <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 11 }}>
                    {meta.title}
                  </span>

                  {/* Subtitle / path preview */}
                  {meta.subtitle && (
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontSize: 10.5,
                        fontFamily: "monospace",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 240,
                      }}
                    >
                      {meta.subtitle}
                    </span>
                  )}

                  {/* Right side: Open link + summary badge + expand chevron */}
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {tc.summary && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--text-subtle)",
                          background: "var(--active-overlay)",
                          padding: "1px 6px",
                          borderRadius: 4,
                        }}
                      >
                        {tc.summary}
                      </span>
                    )}

                    {pathArg && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenFile(pathArg);
                        }}
                        title={`Open ${pathArg} in editor`}
                        style={{
                          color: "var(--cyan)",
                          cursor: "pointer",
                          fontSize: 10,
                          textDecoration: "underline",
                        }}
                      >
                        open
                      </span>
                    )}

                    <span style={{ color: "var(--text-subtle)", display: "flex" }}>
                      {isCallExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </span>
                  </div>
                </div>

                {/* Expanded Output / Result Drawer */}
                {isCallExpanded && (
                  <div
                    style={{
                      borderTop: "1px solid var(--border-subtle)",
                      background: "rgba(0, 0, 0, 0.20)",
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {/* Arguments preview if non-empty */}
                    {tc.args && Object.keys(tc.args).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 9.5, color: "var(--text-subtle)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          Parameters:
                        </span>
                        {Object.entries(tc.args).map(([k, v]) => (
                          <span
                            key={k}
                            style={{
                              fontSize: 10,
                              fontFamily: "monospace",
                              padding: "1px 5px",
                              borderRadius: 4,
                              background: "var(--bg-canvas)",
                              color: "var(--text-muted)",
                              border: "1px solid var(--border-subtle)",
                            }}
                          >
                            <span style={{ color: "var(--text-subtle)" }}>{k}: </span>
                            {typeof v === "string" ? `"${v.length > 50 ? v.slice(0, 50) + '…' : v}"` : String(v)}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Output block */}
                    {tc.output ? (
                      <div style={{ position: "relative" }}>
                        <pre
                          style={{
                            margin: 0,
                            padding: "8px",
                            borderRadius: 6,
                            background: "var(--bg-canvas)",
                            border: "1px solid var(--border-subtle)",
                            color: "var(--text)",
                            fontFamily: "monospace",
                            fontSize: 10.5,
                            lineHeight: 1.45,
                            maxHeight: 220,
                            overflowY: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                          }}
                        >
                          {tc.output}
                        </pre>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(tc.output || "");
                          }}
                          title="Copy output"
                          style={{
                            position: "absolute",
                            top: 4,
                            right: 4,
                            background: "var(--active-overlay)",
                            border: "none",
                            borderRadius: 4,
                            padding: "2px 5px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 3,
                            fontSize: 9.5,
                            color: "var(--text-muted)",
                          }}
                        >
                          <Copy size={10} />
                          <span>Copy</span>
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 10.5, color: "var(--text-subtle)", fontStyle: "italic" }}>
                        {tc.status === "running" ? "Running tool in workspace…" : "Execution finished with no output."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const markdownHtmlCache = new Map<string, string>();

function formatChatMarkdown(content: string, isStreaming?: boolean): string {
  if (!content) {
    return isStreaming ? '<span class="streaming-cursor"></span>' : "";
  }

  let text = content;

  // 1. Mask code blocks and inline code so wiki-links inside backticks are untouched
  const codeMasks: string[] = [];
  text = text.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    codeMasks.push(match);
    return `__ORO_CODE_MASK_${codeMasks.length - 1}__`;
  });

  // 2. Convert [[target|alias]] and [[target]] to interactive wiki-link pills
  text = text.replace(/\[\[([^\[\]]+)\]\]/g, (_match, inner: string) => {
    const [targetAndHeading, alias] = inner.split("|");
    const [target] = (targetAndHeading ?? "").split("#");
    const label = alias?.trim() || target?.trim();
    const cleanTarget = target?.trim() || "";
    return `<a class="chat-wiki-link" data-wiki="${encodeURIComponent(cleanTarget)}" title="Open note in editor"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><span>${escapeHtml(label || cleanTarget)}</span></a>`;
  });

  // 3. Restore masked code
  text = text.replace(/__ORO_CODE_MASK_(\d+)__/g, (_m, idx) => codeMasks[Number(idx)] || "");

  // 4. Handle unclosed code block during streaming
  if (isStreaming) {
    const codeBlockCount = (text.match(/```/g) || []).length;
    if (codeBlockCount % 2 === 1) {
      text += "\n```";
    }
  }

  // 5. Custom marked renderer for syntax / code block headers & copy buttons
  const renderer = new marked.Renderer();
  renderer.code = function ({ text: codeText, lang }: { text: string; lang?: string }) {
    const language = (lang || "code").trim().split(/\s+/)[0] || "code";
    return `<div class="chat-code-block">
      <div class="chat-code-header">
        <span class="chat-code-lang">${escapeHtml(language)}</span>
        <button type="button" class="chat-code-copy-btn no-drag" data-code="${encodeURIComponent(codeText)}" title="Copy code">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          <span>Copy</span>
        </button>
      </div>
      <pre><code class="language-${escapeHtml(language)}">${escapeHtml(codeText)}</code></pre>
    </div>`;
  };

  if (!isStreaming) {
    const cached = markdownHtmlCache.get(text);
    if (cached !== undefined) return cached;
  }

  let html = marked.parse(text, { renderer, breaks: true, gfm: true }) as string;

  if (isStreaming) {
    html += '<span class="streaming-cursor"></span>';
  } else {
    if (markdownHtmlCache.size > 200) {
      const firstKey = markdownHtmlCache.keys().next().value;
      if (firstKey !== undefined) markdownHtmlCache.delete(firstKey);
    }
    markdownHtmlCache.set(text, html);
  }

  return html;
}

interface ChatPanelProps {
  messages: ChatMessageUI[];
  sessionFiles?: SessionFileRecord[];
  isStreaming: boolean;
  activeMode: AgentModeId;
  decidedMode?: "plan" | "builder" | "triad" | null;
  activeFilePath?: string | null;
  config?: OroConfig | null;
  onChangeModel?: (provider: ProviderId, model: string, reasoningEffort?: "low" | "medium" | "high") => void;
  onSendMessage: (text: string) => void;
  onAbort: () => void;
  onOpenFile: (relPath: string) => void;
  onFollowWikiLink?: (target: string) => void;
  onTogglePin?: (relPath: string) => void;
  onSummarize?: () => void;
  onNewSession?: () => void;
  onChangeMode?: (mode: AgentModeId) => void;
  onOpenDiff?: (filePath: string, oldContent?: string) => void;
  isEditorFloatingOpen?: boolean;
  floatingEditorWidth?: number;
  activeSession?: SessionRecord | null;
  onRenameSession?: (id: string, newTitle: string) => void;
  onCloseSession?: (id: string) => void;
  onOpenSettings?: () => void;
  editorDockMode?: "floating" | "split";
  onToggleDockMode?: () => void;
  isEditorOpen?: boolean;
  onToggleEditor?: () => void;
  onRollbackSnapshot?: (snapshotId: string) => Promise<boolean>;
  onUndoToMessage?: (messageId: string) => Promise<string | void>;
}

export const ChatPanel: React.FC<ChatPanelProps> = React.memo(({
  messages,
  sessionFiles,
  isStreaming,
  activeMode,
  decidedMode,
  activeFilePath,
  config,
  onChangeModel,
  onSendMessage,
  onAbort,
  onOpenFile,
  onFollowWikiLink,
  onTogglePin,
  onSummarize,
  onNewSession,
  onChangeMode,
  isEditorFloatingOpen = false,
  floatingEditorWidth = 540,
  activeSession,
  onRenameSession,
  onCloseSession,
  onOpenSettings,
  editorDockMode,
  onToggleDockMode,
  isEditorOpen,
  onToggleEditor,
  onRollbackSnapshot,
  onUndoToMessage,
}) => {
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<DroppedFileInfo[]>([]);
  const [isChatDraggingOver, setIsChatDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [hoveredModeId, setHoveredModeId] = useState<string | null>(null);
  const [chatMenuAnchor, setChatMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [rollingBackId, setRollingBackId] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const isAtBottomRef = useRef(true);
  const [hoveredModelId, setHoveredModelId] = useState<string | null>(null);
  const [dynamicModels, setDynamicModels] = useState<Array<{ id: string; name: string; tag?: string }>>([]);
  const [loadingDynamicModels, setLoadingDynamicModels] = useState(false);
  const [turnStatus, setTurnStatus] = useState<"idle" | "working" | "finished" | "canceled">("idle");
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      setTurnStatus("working");
    } else if (!isStreaming && prevStreamingRef.current) {
      setTurnStatus((prev) => (prev === "canceled" ? "canceled" : "finished"));
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Auto-expand textarea with text
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const nextH = Math.min(Math.max(20, ta.scrollHeight), 160);
    ta.style.height = `${nextH}px`;
  }, [input]);

  const handleQuickPrompt = (promptText: string) => {
    setInput(promptText);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 15);
  };

  const [isLightMode, setIsLightMode] = useState(() => {
    return typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light";
  });

  useEffect(() => {
    const handleThemeChange = () => {
      setIsLightMode(document.documentElement.getAttribute("data-theme") === "light");
    };
    window.addEventListener("oro:theme-change", handleThemeChange);
    const observer = new MutationObserver(() => {
      setIsLightMode(document.documentElement.getAttribute("data-theme") === "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("oro:theme-change", handleThemeChange);
      observer.disconnect();
    };
  }, []);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const modeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Close menus on click outside
  useEffect(() => {
    if (!modelMenuOpen && !modeMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(target) &&
        !modelButtonRef.current?.contains(target)
      ) {
        setModelMenuOpen(false);
      }
      if (
        modeMenuRef.current &&
        !modeMenuRef.current.contains(target) &&
        !modeButtonRef.current?.contains(target)
      ) {
        setModeMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [modelMenuOpen, modeMenuOpen]);

  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<{ name: string; src: string } | null>(null);
  const [streamElapsedSec, setStreamElapsedSec] = useState(0);

  useEffect(() => {
    if (!isStreaming) {
      setStreamElapsedSec(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setStreamElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isStreaming]);

  useEffect(() => {
    if (!lightboxImg) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxImg(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxImg]);

  // Auto-scroll on new messages or stream chunks (only when user is pinned to bottom)
  const handleChatScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 80;
    isAtBottomRef.current = atBottom;
    setShowScrollBottom(!atBottom && scrollHeight > clientHeight + 120);
  };

  const scrollToBottom = () => {
    if (!scrollRef.current) return;
    isAtBottomRef.current = true;
    setShowScrollBottom(false);
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  useEffect(() => {
    if (scrollRef.current && isAtBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const handleMarkdownContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 1. Interactive wiki-link navigation
    const wikiTarget = (e.target as HTMLElement).closest(".chat-wiki-link");
    if (wikiTarget) {
      e.preventDefault();
      const wiki = wikiTarget.getAttribute("data-wiki");
      if (wiki) {
        const decoded = decodeURIComponent(wiki);
        if (onFollowWikiLink) {
          onFollowWikiLink(decoded);
        } else {
          onOpenFile(decoded.endsWith(".md") ? decoded : `${decoded}.md`);
        }
      }
      return;
    }

    // 2. Intercept external <a> links so WebView2 never navigates away from the app
    const anchor = (e.target as HTMLElement).closest("a");
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        window.oro?.openExternal?.(href);
      }
      return;
    }

    // 2. Code snippet copy button
    const copyBtn = (e.target as HTMLElement).closest(".chat-code-copy-btn");
    if (copyBtn) {
      e.preventDefault();
      const code = copyBtn.getAttribute("data-code");
      if (code) {
        const decoded = decodeURIComponent(code);
        navigator.clipboard.writeText(decoded).then(() => {
          copyBtn.classList.add("copied");
          const span = copyBtn.querySelector("span");
          if (span) span.textContent = "Copied!";
          setTimeout(() => {
            copyBtn.classList.remove("copied");
            if (span) span.textContent = "Copy";
          }, 1800);
        });
      }
      return;
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 1800);
    });
  };

  const handleUndoToPoint = async (msgId: string) => {
    if (isStreaming || rollingBackId) return;
    setRollingBackId(msgId);
    try {
      const restoredPrompt = await onUndoToMessage?.(msgId);
      if (typeof restoredPrompt === "string" && restoredPrompt.trim()) {
        setInput(restoredPrompt);
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 40);
      }
    } finally {
      setRollingBackId(null);
    }
  };

  const dragCounterRef = useRef(0);

  // Clear dragging state on global dragend/drop to avoid stuck overlay states
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      dragCounterRef.current = 0;
      setIsChatDraggingOver(false);
    };
    window.addEventListener("dragend", handleGlobalDragEnd);
    window.addEventListener("drop", handleGlobalDragEnd);
    return () => {
      window.removeEventListener("dragend", handleGlobalDragEnd);
      window.removeEventListener("drop", handleGlobalDragEnd);
    };
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    // Only respond to actual file drags or internal note drags
    if (!types.includes("Files") && !types.includes("application/oro-note")) {
      return;
    }
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsChatDraggingOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
    } else if (types.includes("application/oro-note")) {
      e.dataTransfer.dropEffect = "link";
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsChatDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsChatDraggingOver(false);

    // If an internal note or folder was dragged from the sidebar:
    const internalNote = e.dataTransfer.getData("application/oro-note");
    const internalFolder = e.dataTransfer.getData("application/oro-folder");
    if (internalNote) {
      const cleanName = internalNote.split("/").pop()?.replace(/\.md$/, "") || internalNote;
      setInput((prev) => (prev ? `${prev} [[${cleanName}]]` : `[[${cleanName}]]`));
      return;
    }
    if (internalFolder) {
      setInput((prev) => (prev ? `${prev} ${internalFolder}/` : `${internalFolder}/`));
      return;
    }

    const processed = await processDroppedDataTransfer(e.dataTransfer);
    if (processed.length > 0) {
      setAttachedFiles((prev) => [...prev, ...processed]);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const processed = await processDroppedFiles(e.target.files);
      if (processed.length > 0) {
        setAttachedFiles((prev) => [...prev, ...processed]);
      }
      e.target.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if ((!trimmed && attachedFiles.length === 0) || isStreaming) return;
    isAtBottomRef.current = true;

    let finalPrompt = trimmed;
    if (attachedFiles.length > 0) {
      if (!finalPrompt) {
        finalPrompt = `Please review and analyze the attached ${
          attachedFiles.length === 1 ? "file" : `${attachedFiles.length} files`
        }:`;
      }
      const filesContext = attachedFiles
        .map((f) => `### Attached File: ${f.name}\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      finalPrompt = `${finalPrompt}\n\n--- Attached Files ---\n${filesContext}`;

      // In background, save attached files to the workspace vault so agent and user have them in knowledge base
      for (const f of attachedFiles) {
        if (f.base64) {
          window.oro.writeFile(f.name, f.base64, "base64").catch(console.error);
        } else if (f.content) {
          window.oro.writeFile(f.name, f.content, "utf8").catch(console.error);
        }
      }
    }

    setInput("");
    setAttachedFiles([]);
    setTurnStatus("working");
    onSendMessage(finalPrompt);
  };

  const handleAbort = () => {
    setTurnStatus("canceled");
    onAbort();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const currentProvider: ProviderId = config?.provider || "gemini";
  const currentModel: string = config?.providers[currentProvider]?.model || "gemini-3.8-flash";
  const providerSpec = PROVIDER_MODELS[currentProvider] || PROVIDER_MODELS.gemini;
  const currentApiKey = config?.providers[currentProvider]?.apiKey;
  const currentBaseUrl = config?.providers[currentProvider]?.baseUrl;

  // Auto-fetch provider models proactively on load and whenever provider/key updates
  useEffect(() => {
    let cancelled = false;
    const effectiveKey = currentApiKey?.trim();
    if (currentProvider !== "ollama" && !effectiveKey) {
      setDynamicModels([]);
      return;
    }
    setLoadingDynamicModels(true);
    window.oro.fetchProviderModels(currentProvider, effectiveKey, currentBaseUrl)
      .then((models) => {
        if (!cancelled && models && models.length > 0) {
          setDynamicModels(models);
          // Only auto-migrate if currently using deprecated 1.x or 2.x models
          if (currentModel.startsWith("gemini-1.") || currentModel.startsWith("gemini-2.")) {
            onChangeModel?.(currentProvider, models[0].id);
          }
        }
      })
      .catch(() => {
        // Fallback silently to static models
      })
      .finally(() => {
        if (!cancelled) setLoadingDynamicModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProvider, currentApiKey, currentBaseUrl]);

  const displayedModels = useMemo(() => {
    if (dynamicModels.length > 0) {
      return dynamicModels;
    }
    return providerSpec.models;
  }, [dynamicModels, providerSpec]);

  const fullModelName = useMemo(() => {
    return displayedModels.find((m) => m.id === currentModel)?.name || currentModel;
  }, [displayedModels, currentModel]);

  const activeModeColor =
    activeMode === "auto" || activeMode === "triad" || decidedMode === "triad"
      ? (isLightMode ? "#7c3aed" : "#d2a8ff")
      : activeMode === "builder" || decidedMode === "builder"
      ? (isLightMode ? "#16a34a" : "#7EE787")
      : activeMode === "plan" || decidedMode === "plan"
      ? (isLightMode ? "#0284c7" : "#38bdf8")
      : (isLightMode ? "#0284c7" : "#38bdf8");

  const agentModes: { id: AgentModeId; label: string; tag: string; desc: string }[] = useMemo(() => [
    { id: "default", label: "Default", tag: "Std", desc: "Default mode: decides Plan vs Builder based on intent" },
    { id: "auto", label: "Auto", tag: "Auto", desc: "Autonomous pipeline: Architect → Builder → Critic" },
    { id: "plan", label: "Plan", tag: "Plan", desc: "Strategy, research & roadmaps (read-only)" },
    { id: "builder", label: "Builder", tag: "Exec", desc: "Direct file & code execution" },
  ], []);

  const activeModeItem = useMemo(() => {
    if (activeMode === "triad") {
      return agentModes.find((m) => m.id === "auto") || agentModes[1]!;
    }
    return agentModes.find((m) => m.id === activeMode) || agentModes[0]!;
  }, [agentModes, activeMode]);

  const handleCopyTranscript = async () => {
    try {
      const text = messages
        .map((m) => `### ${m.role === "user" ? "User" : "Assistant"}\n\n${m.content}`)
        .join("\n\n---\n\n");
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.warn("Failed to copy transcript:", err);
    }
  };

  const handleRollback = async (snapshot: import("../../types.js").TurnSnapshotRecord) => {
    if (!onRollbackSnapshot || rollingBackId) return;
    setRollingBackId(snapshot.id);
    try {
      await onRollbackSnapshot(snapshot.id);
    } finally {
      setRollingBackId(null);
    }
  };

  return (
    <div
      className="chat-panel-container"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
        background: "transparent",
      }}
    >
      {/* Visual Drop Overlay */}
      {isChatDraggingOver && (
        <div
          style={{
            position: "absolute",
            inset: 6,
            borderRadius: 10,
            background: "var(--prompt-fade)",
            backdropFilter: "blur(6px)",
            border: "2px dashed var(--cyan)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "rgba(56, 189, 248, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--cyan)",
            }}
          >
            <Paperclip size={20} />
          </div>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>
            Drop file or multiple to attach to chat
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Notes, code, documents, and images
          </div>
        </div>
      )}

      {/* Sleek Chat Header with Status Indicator */}
      <div
        style={{
          height: 36,
          minHeight: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          borderBottom: "none",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 550, color: "var(--text)" }}>Chat</span>
          {turnStatus === "working" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 10.5,
                color: "var(--cyan)",
                background: "rgba(56, 189, 248, 0.10)",
                padding: "1.5px 7px",
                borderRadius: 9999,
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cyan)", boxShadow: "0 0 6px var(--cyan)" }} />
              <span>Working</span>
            </span>
          )}
          {turnStatus === "finished" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10.5,
                color: "var(--green)",
                background: "rgba(34, 197, 94, 0.08)",
                padding: "1.5px 7px",
                borderRadius: 9999,
              }}
            >
              <span>✓ Finished</span>
            </span>
          )}
          {turnStatus === "canceled" && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10.5,
                color: "var(--red)",
                background: "rgba(239, 68, 68, 0.08)",
                padding: "1.5px 7px",
                borderRadius: 9999,
              }}
            >
              <span>✕ Canceled</span>
            </span>
          )}
        </div>

        {/* Right Header: Copy Feedback & 3-Dot Column Menu (Antigravity Style) */}
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          {copySuccess && (
            <span
              style={{
                fontSize: 10.5,
                color: "var(--green)",
                background: "rgba(34, 197, 94, 0.12)",
                padding: "2px 8px",
                borderRadius: 9999,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Check size={11} />
              <span>Copied!</span>
            </span>
          )}

          <button
            type="button"
            className={`unified-btn no-drag ${chatMenuAnchor ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (chatMenuAnchor) {
                setChatMenuAnchor(null);
              } else {
                const rect = e.currentTarget.getBoundingClientRect();
                setChatMenuAnchor({
                  x: Math.max(8, rect.right - 200),
                  y: rect.bottom + 6,
                });
              }
            }}
            title="Session options & settings"
            style={{
              width: 24,
              height: 24,
              padding: 0,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: chatMenuAnchor ? "var(--text)" : "var(--text-muted)",
              background: chatMenuAnchor ? "var(--hover-overlay)" : "transparent",
            }}
          >
            <MoreVertical size={14} />
          </button>
        </div>
      </div>

      {/* 3-Dot Dropdown Menu (Antigravity Style) */}
      {chatMenuAnchor && (
        <ContextMenu
          x={chatMenuAnchor.x}
          y={chatMenuAnchor.y}
          items={[
            ...(activeSession && onRenameSession
              ? [
                  {
                    id: "rename",
                    label: "Rename",
                    icon: <Edit3 size={13} />,
                    onClick: async () => {
                      const newTitle = await appPrompt({
                        title: "Rename Session",
                        defaultValue: activeSession.title,
                        placeholder: "Session title...",
                        confirmLabel: "Rename",
                      });
                      if (newTitle && newTitle.trim()) {
                        onRenameSession(activeSession.id, newTitle.trim());
                      }
                    },
                  },
                ]
              : []),
            {
              id: "pin",
              label: "Pin",
              icon: <Pin size={13} />,
              onClick: () => {
                if (activeSession && onTogglePin) {
                  onTogglePin(activeSession.id);
                }
              },
            },
            ...(activeSession && onCloseSession
              ? [
                  {
                    id: "archive",
                    label: "Archive",
                    icon: <Archive size={13} />,
                    onClick: () => onCloseSession(activeSession.id),
                  },
                ]
              : []),
            { id: "div1", divider: true },
            ...(onToggleDockMode
              ? [
                  {
                    id: "split_view",
                    label: editorDockMode === "split" ? "Float Editor" : "Split View",
                    icon: <Columns size={13} />,
                    onClick: onToggleDockMode,
                  },
                ]
              : []),
            {
              id: "copy_transcript",
              label: "Copy",
              icon: <Copy size={13} />,
              onClick: handleCopyTranscript,
            },
            { id: "div2", divider: true },
            ...(onOpenSettings
              ? [
                  {
                    id: "settings",
                    label: "Settings",
                    icon: <Settings size={13} />,
                    shortcut: "Ctrl+,",
                    onClick: onOpenSettings,
                  },
                ]
              : []),
          ]}
          onClose={() => setChatMenuAnchor(null)}
        />
      )}

      {/* Messages Scroll Area */}
      <div className="chat-scroll" ref={scrollRef} onScroll={handleChatScroll}>
        <div
          className="chat-content-container"
          style={{
            width: "100%",
            maxWidth: isEditorFloatingOpen
              ? `min(680px, calc(100% - ${(floatingEditorWidth || 540) + 36}px))`
              : 720,
            margin: isEditorFloatingOpen ? "0 0 0 8px" : "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 18,
            transition: "max-width 0.22s cubic-bezier(0.16, 1, 0.3, 1), margin 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
            minHeight: messages.length === 0 ? "100%" : "auto",
            justifyContent: messages.length === 0 ? "center" : "flex-start",
            alignItems: isEditorFloatingOpen ? "flex-start" : "center",
          }}
        >
        {messages.length === 0 ? (
          <div
            style={{
              margin: isEditorFloatingOpen ? "auto 0" : "auto",
              textAlign: isEditorFloatingOpen ? "left" : "center",
              width: "100%",
              maxWidth: isEditorFloatingOpen ? 480 : 560,
              padding: "24px 16px",
              display: "flex",
              flexDirection: "column",
              alignItems: isEditorFloatingOpen ? "flex-start" : "center",
              boxSizing: "border-box",
            }}
          >
            {/* Editorial Typographic Header */}
            <div
              style={{
                fontWeight: 600,
                fontSize: 22,
                letterSpacing: "-0.03em",
                color: "var(--text)",
                marginBottom: 8,
              }}
            >
              What are we exploring today?
            </div>
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: "var(--text-subtle)",
                marginBottom: 28,
                maxWidth: 440,
              }}
            >
              Ask Oro to read, edit, organize notes, synthesize knowledge graphs, or write code in your workspace.
            </div>

            {/* Quick action suggestion cards — Clean Monolithic Typographic Surfaces */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isEditorFloatingOpen ? "1fr" : "repeat(2, 1fr)",
                gap: 8,
                width: "100%",
                maxWidth: isEditorFloatingOpen ? 460 : 540,
              }}
            >
              <button
                type="button"
                onClick={() => handleQuickPrompt("Summarize my workspace and key notes")}
                className="welcome-action-card"
              >
                <div className="welcome-card-title">Summarize Workspace</div>
                <div className="welcome-card-desc">Synthesize key concepts, active notes & inbox</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickPrompt("Plan architecture for our next feature")}
                className="welcome-action-card"
              >
                <div className="welcome-card-title">Plan Architecture</div>
                <div className="welcome-card-desc">Break requirements into numbered concrete steps</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickPrompt("Find unlinked notes and suggest connections")}
                className="welcome-action-card"
              >
                <div className="welcome-card-title">Knowledge Graph</div>
                <div className="welcome-card-desc">Discover unlinked notes & missing connections</div>
              </button>

              <button
                type="button"
                onClick={() => handleQuickPrompt("Run diagnostics on my notes and report any broken links")}
                className="welcome-action-card"
              >
                <div className="welcome-card-title">Audit Link Integrity</div>
                <div className="welcome-card-desc">Verify wiki-links, frontmatter & task syntax</div>
              </button>
            </div>
          </div>
        ) : (
          messages.map((m) => {
            if (m.role === "user") {
              return (
                <div key={m.id} className="user-msg-group">
                  <div className="msg-bubble-user">
                    {m.content}
                  </div>
                  <div className="msg-actions-row user-actions">
                    <button
                      type="button"
                      className={`msg-action-btn no-drag ${copiedMsgId === m.id ? "copied" : ""}`}
                      onClick={() => handleCopyMessage(m.id, m.content)}
                      title="Copy prompt"
                    >
                      {copiedMsgId === m.id ? (
                        <>
                          <Check size={12} style={{ color: "#22c55e" }} />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isStreaming || rollingBackId !== null}
                      className="msg-action-btn no-drag undo-btn"
                      onClick={() => handleUndoToPoint(m.id)}
                      title="Undo to this prompt and edit"
                    >
                      {rollingBackId === m.id ? (
                        <>
                          <Loader2 size={12} className="spin" />
                          <span>Undoing...</span>
                        </>
                      ) : (
                        <>
                          <Undo2 size={12} />
                          <span>Undo to this point</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            }

            if (m.role === "system") {
              return (
                <div
                  key={m.id}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    background: "var(--bg-surface)",
                    borderLeft: "3px solid var(--cyan)",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    lineHeight: 1.5,
                  }}
                  dangerouslySetInnerHTML={{ __html: marked.parse(m.content) as string }}
                />
              );
            }

            return (
              <div key={m.id} className="msg-bubble-assistant">
                {/* Subagent Swarm Orchestration Cards */}
                {m.subagents && m.subagents.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                    {m.subagents.map((sub) => (
                      <div
                        key={sub.id}
                        className="tool-card"
                        style={{
                          borderLeft: "3px solid #f472b6",
                          background: "var(--card-bg, rgba(244, 114, 182, 0.05))",
                          padding: "7px 10px",
                          borderRadius: 6,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: sub.status === "running" ? "#f472b6" : sub.status === "done" ? "#22c55e" : "#ef4444",
                                boxShadow: sub.status === "running" ? "0 0 6px #f472b6" : "none",
                              }}
                            />
                            <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 11.5 }}>
                              {sub.role}
                            </span>
                            <span
                              style={{
                                fontSize: 9.5,
                                color: "#f472b6",
                                background: "rgba(244, 114, 182, 0.12)",
                                padding: "1px 5px",
                                borderRadius: 4,
                                textTransform: "capitalize",
                              }}
                            >
                              {sub.modelTier || "subagent"}
                            </span>
                          </div>
                          <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>
                            {sub.status === "running" ? "Working..." : sub.status === "done" ? "Finished" : "Error"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
                          {sub.task}
                        </div>
                        {sub.findings && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: "5px 8px",
                              background: "var(--hover-overlay)",
                              borderRadius: 4,
                              fontSize: 10.5,
                              color: "var(--text)",
                              fontFamily: "var(--system-font)",
                              lineHeight: 1.4,
                              maxHeight: 120,
                              overflowY: "auto",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {sub.findings}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tool calls execution timeline rollup accordion */}
                {m.toolCalls && m.toolCalls.length > 0 && (
                  <ToolCallsAccordion toolCalls={m.toolCalls} onOpenFile={onOpenFile} />
                )}

                {/* Assistant Markdown Stream / Content */}
                <div
                  className="chat-markdown"
                  dangerouslySetInnerHTML={{
                    __html: formatChatMarkdown(m.content || "", m.streaming),
                  }}
                  onClick={handleMarkdownContainerClick}
                />

                {/* Message Actions Row (Copy / Undo / Model Info) */}
                {!m.streaming && m.content && (
                  <div className="msg-actions-row">
                    <button
                      type="button"
                      className={`msg-action-btn no-drag ${copiedMsgId === m.id ? "copied" : ""}`}
                      onClick={() => handleCopyMessage(m.id, m.content)}
                      title="Copy response markdown"
                    >
                      {copiedMsgId === m.id ? (
                        <>
                          <Check size={12} style={{ color: "#22c55e" }} />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isStreaming || rollingBackId !== null}
                      className="msg-action-btn no-drag undo-btn"
                      onClick={() => handleUndoToPoint(m.id)}
                      title="Undo conversation to this response"
                    >
                      {rollingBackId === m.id ? (
                        <>
                          <Loader2 size={12} className="spin" />
                          <span>Undoing...</span>
                        </>
                      ) : (
                        <>
                          <Undo2 size={12} />
                          <span>Undo to this point</span>
                        </>
                      )}
                    </button>
                    {activeSession?.model && (
                      <span style={{ fontSize: 10.5, color: "var(--text-subtle)", opacity: 0.8, marginLeft: "auto" }}>
                        {activeSession.model}
                      </span>
                    )}
                  </div>
                )}

                {/* Per-Turn Workspace Snapshot Rollback Pill */}
                {m.snapshot && m.snapshot.manifest && m.snapshot.manifest.length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      paddingTop: 8,
                      borderTop: "1px dashed var(--border-subtle)",
                    }}
                  >
                    <button
                      type="button"
                      disabled={m.snapshot.status === "reverted" || rollingBackId === m.snapshot.id}
                      onClick={() => handleRollback(m.snapshot!)}
                      className="unified-btn no-drag"
                      style={{
                        fontSize: 11,
                        height: 25,
                        padding: "0 10px",
                        borderRadius: 9999,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        color: m.snapshot.status === "reverted" ? "var(--text-subtle)" : "#f59e0b",
                        border: `1px solid ${m.snapshot.status === "reverted" ? "var(--border)" : "rgba(245, 158, 11, 0.45)"}`,
                        background: m.snapshot.status === "reverted" ? "transparent" : "rgba(245, 158, 11, 0.08)",
                        cursor: m.snapshot.status === "reverted" ? "default" : "pointer",
                      }}
                      title={
                        m.snapshot.status === "reverted"
                          ? "Changes have been rolled back"
                          : "Revert all file modifications and creations made in this turn"
                      }
                    >
                      {m.snapshot.status === "reverted" ? (
                        <>
                          <Check size={11} style={{ color: "var(--green)" }} />
                          <span>Rolled Back ({m.snapshot.manifest.length} {m.snapshot.manifest.length === 1 ? "file" : "files"})</span>
                        </>
                      ) : rollingBackId === m.snapshot.id ? (
                        <>
                          <RotateCcw size={11} className="spin-slow" />
                          <span>Reverting...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw size={11} />
                          <span>Revert Changes ({m.snapshot.manifest.length} {m.snapshot.manifest.length === 1 ? "file" : "files"})</span>
                        </>
                      )}
                    </button>
                    <span style={{ fontSize: 10.5, color: "var(--text-subtle)" }}>
                      {m.snapshot.manifest
                        .slice(0, 3)
                        .map((item) => `${item.action === "created" ? "+" : item.action === "deleted" ? "-" : "~"}${item.path}`)
                        .join(", ")}
                      {m.snapshot.manifest.length > 3 ? ` +${m.snapshot.manifest.length - 3} more` : ""}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
        </div>
      </div>

      {/* Floating Prompt Area Island */}
      <div className="floating-prompt-wrapper" style={{ padding: "0 24px 12px 24px", position: "relative" }}>
        {showScrollBottom && (
          <button
            type="button"
            className="scroll-to-bottom-btn no-drag"
            onClick={scrollToBottom}
            title="Jump to latest message"
            aria-label="Jump to latest message"
          >
            <ArrowDown size={14} />
          </button>
        )}
        {isStreaming && streamElapsedSec >= 2 && (
          <div className="stream-elapsed-pill" aria-live="polite">
            <span className="stream-pulse-dot" />
            <span>Working · {streamElapsedSec}s</span>
          </div>
        )}
        <form
          onSubmit={handleSubmit}
          className="floating-prompt-box"
          style={{
            position: "relative",
            width: "100%",
            maxWidth: isEditorFloatingOpen
              ? `min(680px, calc(100% - ${(floatingEditorWidth || 540) + 36}px))`
              : 720,
            margin: isEditorFloatingOpen ? "0 0 0 8px" : "0 auto",
            transition: "max-width 0.22s cubic-bezier(0.16, 1, 0.3, 1), margin 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Attached Files Chips Row */}
          {attachedFiles.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                flexWrap: "wrap",
                marginBottom: 6,
                maxHeight: 90,
                overflowY: "auto",
              }}
            >
              {attachedFiles.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "2px 8px",
                    borderRadius: 9999,
                    background: "var(--hover-overlay)",
                    border: "1px solid var(--border)",
                    fontSize: 11,
                    color: "var(--text)",
                    maxWidth: 240,
                  }}
                >
                  {f.isImage && f.base64 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxImg({
                          name: f.name,
                          src: `data:${f.type || "image/png"};base64,${f.base64}`,
                        })
                      }
                      title="Preview image"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        cursor: "pointer",
                        minWidth: 0,
                      }}
                    >
                      <img
                        src={`data:${f.type || "image/png"};base64,${f.base64}`}
                        alt={f.name}
                        style={{ width: 16, height: 16, borderRadius: 3, objectFit: "cover", flexShrink: 0 }}
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.name}
                      </span>
                    </button>
                  ) : (
                    <>
                      {f.isImage ? (
                        <ImageIcon size={11} style={{ color: "var(--cyan)", flexShrink: 0 }} />
                      ) : (
                        <FileText size={11} style={{ color: "var(--cyan)", flexShrink: 0 }} />
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.name}
                      </span>
                    </>
                  )}
                  <span style={{ fontSize: 9.5, color: "var(--text-subtle)", flexShrink: 0 }}>
                    ({formatFileSize(f.size)})
                  </span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(i)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      marginLeft: 2,
                    }}
                    title="Remove attachment"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            className="prompt-textarea"
            placeholder="Reply to Oro... (Shift+Enter for new line, drop files to attach)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={async (e) => {
              const items = e.clipboardData?.items;
              if (!items) return;
              const imgFiles: File[] = [];
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item && item.type.startsWith("image/")) {
                  const f = item.getAsFile();
                  if (f) imgFiles.push(f);
                }
              }
              if (imgFiles.length > 0) {
                e.preventDefault();
                const processed = await processDroppedFiles(imgFiles);
                if (processed.length > 0) {
                  setAttachedFiles((prev) => [...prev, ...processed]);
                }
              }
            }}
            rows={1}
            style={{
              minHeight: 20,
              maxHeight: 160,
              fontSize: 12.5,
              lineHeight: 1.35,
              padding: "1px 0",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, gap: 6, minWidth: 0 }}>
            {/* Mode & Model Selector Buttons on left */}
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 3, minWidth: 0, flex: "1 1 auto", overflow: "visible" }}>
              {/* Mode Selector Button */}
              <button
                ref={modeButtonRef}
                type="button"
                onClick={() => setModeMenuOpen((v) => !v)}
                className="unified-btn"
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  gap: 3,
                  minWidth: 0,
                  flexShrink: 0,
                  borderRadius: 9999,
                  background: "transparent",
                  border: "none",
                  color: "var(--text)",
                }}
                title={`Mode: ${activeModeItem.label} — ${activeModeItem.desc}`}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 450 }}>
                  {activeModeItem.label}
                </span>
                <ChevronDown size={9} style={{ opacity: 0.65, flexShrink: 0 }} />
              </button>

              {/* Mode Popover */}
              {modeMenuOpen && (
                <div
                  ref={modeMenuRef}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                    width: 155,
                    background: "var(--modal-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.40)",
                    padding: 3,
                    zIndex: 1001,
                    overflow: "visible",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      overflow: "visible",
                    }}
                  >
                    {agentModes.map((m) => {
                      const isSelected = m.id === activeMode || (m.id === "auto" && activeMode === "triad");
                      const isHovered = hoveredModeId === m.id;

                      return (
                        <div
                          key={m.id}
                          onMouseEnter={() => setHoveredModeId(m.id)}
                          onMouseLeave={() => setHoveredModeId(null)}
                          onClick={() => {
                            onChangeMode?.(m.id);
                            setModeMenuOpen(false);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "3px 5px",
                            borderRadius: 5,
                            cursor: "pointer",
                            background: isSelected
                              ? "var(--active-overlay)"
                              : isHovered
                              ? "var(--hover-overlay)"
                              : "transparent",
                            transition: "background 0.12s ease",
                          }}
                        >
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: isSelected ? 500 : 400,
                              color: isSelected ? "var(--text)" : "var(--text-muted)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              flex: 1,
                            }}
                            title={m.desc}
                          >
                            {m.label}
                          </span>

                          <span
                            style={{
                              fontSize: 8.5,
                              fontWeight: 450,
                              color: "var(--text-subtle)",
                              background: "rgba(255, 255, 255, 0.05)",
                              padding: "1px 4px",
                              borderRadius: 3,
                              flexShrink: 0,
                              marginLeft: 4,
                            }}
                          >
                            {m.tag}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Model Selector Button on left */}
              <button
                ref={modelButtonRef}
                type="button"
                onClick={() => setModelMenuOpen((v) => !v)}
                className="unified-btn"
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  gap: 3,
                  minWidth: 0,
                  flexShrink: 0,
                  borderRadius: 9999,
                  background: "transparent",
                  border: "none",
                  color: "var(--text)",
                }}
                title={`Model: ${fullModelName}`}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 450 }}>
                  {fullModelName}
                </span>
                <ChevronDown size={9} style={{ opacity: 0.65, flexShrink: 0 }} />
              </button>

              {/* Attach File Button */}
              <input
                type="file"
                multiple
                ref={fileInputRef}
                onChange={handleFileInputChange}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="unified-btn no-drag"
                onClick={() => fileInputRef.current?.click()}
                title="Attach files (or drag & drop files into chat)"
                style={{
                  width: 20,
                  height: 20,
                  padding: 0,
                  borderRadius: "50%",
                  color: "var(--text-muted)",
                  marginLeft: 3,
                  flexShrink: 0,
                }}
              >
                <Paperclip size={11} />
              </button>

              {/* Model Selector Popover (Minimal, text-only, no provider section, hover thinking effort flyout) */}
              {modelMenuOpen && (
                <div
                  ref={modelMenuRef}
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                    width: 155,
                    background: "var(--modal-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.40)",
                    padding: 3,
                    zIndex: 1000,
                    overflow: "visible",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                      overflow: "visible",
                    }}
                  >
                    {displayedModels.map((m) => {
                      const isSelected = m.id === currentModel;
                      const isHovered = hoveredModelId === m.id;
                      const currentEffort = config?.providers[currentProvider]?.reasoningEffort || "medium";

                      return (
                        <div
                          key={m.id}
                          style={{ position: "relative" }}
                          onMouseEnter={() => setHoveredModelId(m.id)}
                          onMouseLeave={() => setHoveredModelId(null)}
                        >
                          <div
                            onClick={() => {
                              onChangeModel?.(currentProvider, m.id);
                              setModelMenuOpen(false);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "3px 5px",
                              borderRadius: 5,
                              cursor: "pointer",
                              background: isSelected
                                ? "var(--active-overlay)"
                                : isHovered
                                ? "var(--hover-overlay)"
                                : "transparent",
                              transition: "background 0.12s ease",
                            }}
                          >
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: isSelected ? 500 : 400,
                                color: isSelected ? "var(--text)" : "var(--text-muted)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                flex: 1,
                              }}
                              title={m.id}
                            >
                              {m.name}
                            </span>

                            {m.tag && (
                              <span
                                style={{
                                  fontSize: 8.5,
                                  fontWeight: 450,
                                  color: "var(--text-subtle)",
                                  background: "rgba(255, 255, 255, 0.05)",
                                  padding: "1px 4px",
                                  borderRadius: 3,
                                  flexShrink: 0,
                                  marginLeft: 4,
                                }}
                              >
                                {m.tag}
                              </span>
                            )}
                          </div>

                          {/* Thinking Effort Floating Flyout on Hover */}
                          {isHovered && (
                            <div
                              style={{
                                position: "absolute",
                                left: "calc(100% + 4px)",
                                top: -2,
                                width: 105,
                                background: "var(--modal-bg)",
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.40)",
                                padding: "4px 3px",
                                zIndex: 1050,
                                display: "flex",
                                flexDirection: "column",
                                gap: 1,
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* Invisible hover bridge to prevent mouseleave jitter */}
                              <div
                                style={{
                                  position: "absolute",
                                  left: -8,
                                  top: 0,
                                  bottom: 0,
                                  width: 10,
                                }}
                              />
                              <div
                                style={{
                                  fontSize: 8,
                                  fontWeight: 600,
                                  color: "var(--text-subtle)",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em",
                                  padding: "2px 5px",
                                }}
                              >
                                Thinking Effort
                              </div>
                              {(["low", "medium", "high"] as const).map((lvl) => {
                                const isEffortActive = isSelected && currentEffort === lvl;
                                return (
                                  <button
                                    key={lvl}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onChangeModel?.(currentProvider, m.id, lvl);
                                      setModelMenuOpen(false);
                                    }}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      padding: "3px 6px",
                                      borderRadius: 5,
                                      border: "none",
                                      fontSize: 10,
                                      fontWeight: isEffortActive ? 550 : 400,
                                      background: isEffortActive ? "var(--active-overlay)" : "transparent",
                                      color: isEffortActive ? "var(--text)" : "var(--text-muted)",
                                      cursor: "pointer",
                                      textTransform: "capitalize",
                                      width: "100%",
                                      textAlign: "left",
                                      transition: "background 0.12s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                      if (!isEffortActive) e.currentTarget.style.background = "var(--hover-overlay)";
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isEffortActive) e.currentTarget.style.background = "transparent";
                                    }}
                                  >
                                    <span>{lvl}</span>
                                    {isEffortActive && <Check size={10} style={{ color: "var(--cyan)" }} />}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Send / Stop button docked firmly on right with flexShrink: 0 */}
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", marginLeft: 6 }}>
              {isStreaming ? (
                <button
                  type="button"
                  className="unified-btn"
                  onClick={handleAbort}
                  style={{
                    background: isLightMode ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.12)",
                    color: "var(--text)",
                    fontWeight: 500,
                    padding: "0 8px",
                    height: 24,
                    borderRadius: 9999,
                    gap: 4,
                  }}
                  title="Stop Generating"
                >
                  <Square size={9} fill="currentColor" />
                  <span style={{ fontSize: 10.5 }}>Stop</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && attachedFiles.length === 0}
                  className="unified-btn"
                  style={{
                    width: 24,
                    height: 24,
                    padding: 0,
                    borderRadius: "50%",
                    background: (input.trim() || attachedFiles.length > 0)
                      ? (isLightMode ? "#09090b" : "#f4f4f5")
                      : "transparent",
                    color: (input.trim() || attachedFiles.length > 0)
                      ? (isLightMode ? "#ffffff" : "#09090b")
                      : "var(--text-subtle)",
                    border: (input.trim() || attachedFiles.length > 0) ? "none" : "1px solid var(--border)",
                    cursor: (input.trim() || attachedFiles.length > 0) ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s ease",
                    opacity: (input.trim() || attachedFiles.length > 0) ? 1 : 0.6,
                  }}
                  title="Send Message (Enter)"
                >
                  <ArrowUp size={12} strokeWidth={2.4} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Screenshot Lightbox Preview */}
      {lightboxImg && (
        <div
          className="modal-overlay"
          style={{ zIndex: 10040, backdropFilter: "blur(6px)" }}
          onClick={() => setLightboxImg(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "88vw",
              maxHeight: "88vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <img
              src={lightboxImg.src}
              alt={lightboxImg.name}
              style={{
                maxWidth: "85vw",
                maxHeight: "80vh",
                borderRadius: 10,
                boxShadow: "0 4px 16px rgba(0,0,0,0.35), 0 18px 48px rgba(0,0,0,0.5)",
                border: "1px solid var(--border)",
              }}
            />
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {lightboxImg.name} — Click anywhere or press Esc to close
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
