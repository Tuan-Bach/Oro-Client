import React, { useState, useRef, useEffect } from "react";
import {
  FolderPlus,
  ChevronDown,
  Sparkles,
  Settings,
  MoreVertical,
  Edit3,
  FolderTree,
  PanelLeftClose,
  PanelLeft,
  PanelRightClose,
  PanelRight,
  Plus,
  X,
  Minus,
  Square,
  Search,
  FileText,
  FilePlus,
  RefreshCw,
  Sliders,
  Copy,
  Trash2,
} from "lucide-react";
import type { AgentModeId, OroConfig, SessionRecord } from "../../types.js";
import type { WorkspaceSummary } from "../../ipc-types.js";
import { ContextMenu } from "./ContextMenu.js";
import { WorkspaceDropdown } from "./WorkspaceDropdown.js";
import { appPrompt } from "./AppDialog.js";

interface TitleBarProps {
  workspace: WorkspaceSummary | null;
  session: SessionRecord | null;
  sessions: SessionRecord[];
  mode?: AgentModeId;
  config: OroConfig | null;
  sidebarOpen: boolean;
  sidebarWidth?: number;
  activeFilePath?: string | null;
  onToggleSidebar: () => void;
  onOpenWorkspacePicker: () => void;
  onNewWorkspace?: () => void;
  onSwitchWorkspace?: (folderPath: string, options?: { seedStarter?: boolean }) => void;
  onConfigureSession?: (session: SessionRecord) => void;
  isEditorOpen?: boolean;
  onToggleEditor?: () => void;
  onSwitchSession: (id: string) => void;
  onNewSession: () => void;
  onCloseSession?: (id: string) => void;
  onRenameSession?: (id: string, newTitle: string) => void;
  onDistill?: () => void;
  onOpenModelModal: () => void;
  onOpenSettings: () => void;
  onChangeMode?: (mode: AgentModeId) => void;
  onOpenCommandPalette?: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  isReindexing?: boolean;
  onReindex?: () => void;
  viewMode?: "editor" | "split" | "preview" | "diff";
  onChangeViewMode?: (mode: "editor" | "split" | "preview" | "diff") => void;
  hasDiff?: boolean;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  workspace,
  session,
  sessions,
  config,
  sidebarOpen,
  sidebarWidth = 250,
  activeFilePath,
  onToggleSidebar,
  onOpenWorkspacePicker,
  onNewWorkspace,
  onSwitchWorkspace,
  onConfigureSession,
  isEditorOpen,
  onToggleEditor,
  onSwitchSession,
  onNewSession,
  onCloseSession,
  onRenameSession,
  onDistill,
  onOpenModelModal,
  onOpenSettings,
  onOpenCommandPalette,
  onNewFile,
  onNewFolder,
  isReindexing = false,
  onReindex,
  viewMode = "split",
  onChangeViewMode,
  hasDiff,
}) => {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [isWorkspaceDropdownOpen, setIsWorkspaceDropdownOpen] = useState(false);
  const workspaceBtnRef = useRef<HTMLButtonElement>(null);
  const [workspaceAnchorRect, setWorkspaceAnchorRect] = useState<DOMRect | null>(null);
  const [sessionContextMenu, setSessionContextMenu] = useState<{
    x: number;
    y: number;
    session: SessionRecord;
  } | null>(null);

  const handleToggleMoreMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moreMenuAnchor) {
      setMoreMenuAnchor(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMoreMenuAnchor({
        x: Math.max(8, rect.right - 210),
        y: rect.bottom + 6,
      });
    }
  };

  const provider = config?.provider ?? "gemini";
  const model = config?.providers[provider]?.model ?? "gemini-3.8-flash";
  const hasKey = provider === "ollama" || Boolean(config?.providers[provider]?.apiKey);
  const isMarkdown = !activeFilePath || activeFilePath.toLowerCase().endsWith(".md");

  const handleWindowControl = (action: "minimize" | "maximize" | "close") => {
    try {
      window.oro?.windowControl?.(action);
    } catch (e) {
      console.warn("Window control failed:", e);
    }
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      {/* ── ROW 1: Window Controls, Workspace Vault & Session Tabs (Height 34px) ── */}
      <div
        className="titlebar-row-1"
        data-tauri-drag-region
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 34,
          minHeight: 34,
          padding: "0 0 0 10px",
          boxSizing: "border-box",
          userSelect: "none",
          width: "100%",
        }}
      >
        {/* Left: Oro Brand & Workspace Vault Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          <span
            style={{
              fontWeight: 600,
              color: "var(--text)",
              fontSize: 12,
              letterSpacing: "0.02em",
              display: "flex",
              alignItems: "center",
              padding: "0 2px",
              userSelect: "none",
            }}
          >
            Oro
          </span>

          <span style={{ color: "var(--border-subtle)", fontSize: 10, margin: "0 1px" }}>│</span>

          <button
            ref={workspaceBtnRef}
            type="button"
            className={`unified-btn no-drag ${isWorkspaceDropdownOpen ? "active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              if (workspaceBtnRef.current) {
                setWorkspaceAnchorRect(workspaceBtnRef.current.getBoundingClientRect());
              }
              setIsWorkspaceDropdownOpen((prev) => !prev);
            }}
            title="Switch Workspace Vault"
            style={{
              maxWidth: 160,
              fontSize: 11,
              height: 22,
              padding: "0 8px",
              background: isWorkspaceDropdownOpen ? "var(--hover-overlay)" : "transparent",
              border: isWorkspaceDropdownOpen ? "1px solid var(--border)" : "none",
              borderRadius: 9999,
              gap: 4,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {workspace?.name || "Workspace"}
            </span>
            <ChevronDown
              size={10}
              style={{
                opacity: 0.6,
                flexShrink: 0,
                transform: isWorkspaceDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
              }}
            />
          </button>
        </div>

        {/* Draggable spacer across row 1 */}
        <div className="titlebar-drag-spacer" data-tauri-drag-region style={{ flex: 1, minWidth: 20, height: "100%" }} />

        {/* Right: Search, Connect API, Settings, Window Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
          {onOpenCommandPalette && (
            <button
              className="unified-btn no-drag"
              onClick={onOpenCommandPalette}
              title="Search Notes & Commands (Ctrl+K / Ctrl+P)"
              style={{
                width: 26,
                height: 26,
                padding: 0,
                borderRadius: 9999,
                color: "var(--text-muted)",
              }}
            >
              <Search size={13} />
            </button>
          )}

          {!hasKey && (
            <button
              className="unified-btn no-drag"
              onClick={onOpenSettings}
              title="Configure AI API Key in Settings"
              style={{ fontSize: 11, height: 22, padding: "0 8px", borderRadius: 9999 }}
            >
              <Sparkles size={11} style={{ color: "#d4a373", flexShrink: 0 }} />
              <span>Connect API</span>
            </button>
          )}

          <button
            className={`unified-btn no-drag ${moreMenuAnchor ? "active" : ""}`}
            onClick={handleToggleMoreMenu}
            title="Settings & Menu (Ctrl+,)"
            style={{
              width: 26,
              height: 26,
              padding: 0,
              borderRadius: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: moreMenuAnchor ? "var(--text)" : "var(--text-muted)",
              background: moreMenuAnchor ? "var(--hover-overlay)" : "transparent",
            }}
          >
            <MoreVertical size={14} />
          </button>

          <div className="no-drag window-controls-group">
            <button
              className="window-control-btn"
              onClick={() => handleWindowControl("minimize")}
              title="Minimize"
            >
              <Minus size={11} strokeWidth={1.5} />
            </button>
            <button
              className="window-control-btn"
              onClick={() => handleWindowControl("maximize")}
              title="Maximize"
            >
              <Square size={9} strokeWidth={1.3} />
            </button>
            <button
              className="window-control-btn window-control-close"
              onClick={() => handleWindowControl("close")}
              title="Close"
            >
              <X size={11} strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </div>

      {/* ── ROW 2: Action Bar (Second Floor) ──
          Left: Sidebar Controls (Toggle, New Note, New Folder, Refresh)
          Center: Session Tabs (Aligned with Chat Column!)
          Right: Editor View Controls (Edit, Split, Read, Diff) & Close Editor */}
      <div
        className="titlebar-row-2"
        style={{
          display: "flex",
          alignItems: "center",
          height: 34,
          minHeight: 34,
          padding: "0 6px",
          gap: 6,
          boxSizing: "border-box",
          userSelect: "none",
          width: "100%",
        }}
      >
        {/* Left: Sidebar Controls (matches sidebar width so Session tabs align directly with Chat column) */}
        <div
          style={{
            width: sidebarOpen ? sidebarWidth : 26,
            minWidth: sidebarOpen ? 180 : 26,
            maxWidth: sidebarOpen ? "35vw" : 26,
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexShrink: 0,
            paddingLeft: 2,
            boxSizing: "border-box",
          }}
        >
          <button
            className="unified-btn no-drag"
            onClick={onToggleSidebar}
            title={sidebarOpen ? "Close Sidebar (Ctrl+B)" : "Open Sidebar (Ctrl+B)"}
            style={{ width: 24, height: 24, padding: 0, borderRadius: 9999 }}
          >
            {sidebarOpen ? <PanelLeftClose size={13} /> : <PanelLeft size={13} />}
          </button>

          {sidebarOpen && onNewFile && (
            <button
              className="unified-btn no-drag"
              onClick={onNewFile}
              title="New Note (Ctrl+N)"
              style={{ width: 24, height: 24, padding: 0, borderRadius: 9999 }}
            >
              <FilePlus size={13} style={{ color: "var(--cyan)" }} />
            </button>
          )}

          {sidebarOpen && onNewFolder && (
            <button
              className="unified-btn no-drag"
              onClick={onNewFolder}
              title="New Folder (Ctrl+Shift+N)"
              style={{ width: 24, height: 24, padding: 0, borderRadius: 9999 }}
            >
              <FolderPlus size={13} />
            </button>
          )}

          {sidebarOpen && onReindex && (
            <button
              className={`unified-btn no-drag ${isReindexing ? "active" : ""}`}
              onClick={onReindex}
              disabled={isReindexing}
              title={isReindexing ? "Refreshing workspace..." : "Refresh Workspace"}
              style={{
                width: 24,
                height: 24,
                padding: 0,
                borderRadius: 9999,
                opacity: isReindexing ? 0.7 : 1,
                cursor: isReindexing ? "wait" : "pointer",
              }}
            >
              <RefreshCw
                size={12}
                className={isReindexing ? "spin" : ""}
                style={{ color: isReindexing ? "var(--cyan)" : "inherit" }}
              />
            </button>
          )}
        </div>

        {/* Center: Session Tabs + New Session (+) Button — Aligned with Left of Chat Column */}
        <div
          className="session-tabs-container no-drag"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            overflowX: "auto",
            scrollbarWidth: "none",
            flex: 1,
            minWidth: 0,
            paddingLeft: 6,
            boxSizing: "border-box",
          }}
        >
          {sessions.map((s) => {
            const isActive = s.id === session?.id;
            return (
              <div
                key={s.id}
                className={`session-tab no-drag ${isActive ? "active" : ""}`}
                onClick={() => onSwitchSession(s.id)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditingSessionId(s.id);
                  setEditingTitle(s.title);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSessionContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    session: s,
                  });
                }}
                title={editingSessionId === s.id ? "" : `Session: ${s.title}\nRight-click to configure • Double-click to rename`}
              >
                {editingSessionId === s.id ? (
                  <input
                    type="text"
                    autoFocus
                    className="no-drag"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (editingTitle.trim() && onRenameSession) {
                          onRenameSession(s.id, editingTitle.trim());
                        }
                        setEditingSessionId(null);
                      } else if (e.key === "Escape") {
                        setEditingSessionId(null);
                      }
                    }}
                    onBlur={() => {
                      if (editingTitle.trim() && onRenameSession) {
                        onRenameSession(s.id, editingTitle.trim());
                      }
                      setEditingSessionId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: "var(--input-bg)",
                      color: "var(--text)",
                      border: "1px solid var(--border-focus)",
                      borderRadius: 4,
                      fontSize: 11,
                      padding: "1px 5px",
                      outline: "none",
                      width: 90,
                      height: 18,
                    }}
                  />
                ) : (
                  <span className="session-tab-title">{s.title}</span>
                )}
                {sessions.length > 1 && onCloseSession && (
                  <span
                    className="session-tab-close no-drag"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseSession(s.id);
                    }}
                    title="Close session"
                  >
                    <X size={9} />
                  </span>
                )}
              </div>
            );
          })}

          <button
            className="unified-btn no-drag session-new-btn"
            onClick={onNewSession}
            title="New Chat Session"
            style={{ width: 20, height: 20, padding: 0 }}
          >
            <Plus size={11} />
          </button>
        </div>

        {/* Right: Editor View Mode Switcher (Edit, Split, Read, Diff) & Close Editor */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, paddingRight: 2 }}>
          {isEditorOpen && onChangeViewMode && (
            <div
              style={{
                display: "inline-flex",
                background: "var(--hover-overlay)",
                borderRadius: 9999,
                padding: 2,
                gap: 1,
              }}
            >
              {isMarkdown ? (
                <>
                  <button
                    type="button"
                    className={`unified-btn no-drag ${viewMode === "editor" ? "active" : ""}`}
                    onClick={() => onChangeViewMode("editor")}
                    title="Edit Source Code / Markdown"
                    style={{
                      fontSize: 10.5,
                      height: 22,
                      padding: "0 8px",
                      borderRadius: 9999,
                      fontWeight: viewMode === "editor" ? 600 : 400,
                      background: viewMode === "editor" ? "var(--active-overlay)" : "transparent",
                      color: viewMode === "editor" ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={`unified-btn no-drag ${viewMode === "split" ? "active" : ""}`}
                    onClick={() => onChangeViewMode("split")}
                    title="Split Side-by-Side Editor & Preview"
                    style={{
                      fontSize: 10.5,
                      height: 22,
                      padding: "0 8px",
                      borderRadius: 9999,
                      fontWeight: viewMode === "split" ? 600 : 400,
                      background: viewMode === "split" ? "var(--active-overlay)" : "transparent",
                      color: viewMode === "split" ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    Split
                  </button>
                  <button
                    type="button"
                    className={`unified-btn no-drag ${viewMode === "preview" ? "active" : ""}`}
                    onClick={() => onChangeViewMode("preview")}
                    title="Formatted Reading View"
                    style={{
                      fontSize: 10.5,
                      height: 22,
                      padding: "0 8px",
                      borderRadius: 9999,
                      fontWeight: viewMode === "preview" ? 600 : 400,
                      background: viewMode === "preview" ? "var(--active-overlay)" : "transparent",
                      color: viewMode === "preview" ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    Read
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="unified-btn no-drag active"
                  style={{
                    fontSize: 10.5,
                    height: 22,
                    padding: "0 8px",
                    borderRadius: 9999,
                    fontWeight: 500,
                    background: "var(--active-overlay)",
                    color: "var(--text)",
                  }}
                >
                  Code
                </button>
              )}

              {hasDiff && (
                <button
                  type="button"
                  className={`unified-btn no-drag ${viewMode === "diff" ? "active" : ""}`}
                  onClick={() => onChangeViewMode("diff")}
                  title="Compare Git Diff"
                  style={{
                    fontSize: 10.5,
                    height: 22,
                    padding: "0 8px",
                    borderRadius: 9999,
                    fontWeight: viewMode === "diff" ? 600 : 400,
                    background: viewMode === "diff" ? "var(--active-overlay)" : "transparent",
                    color: viewMode === "diff" ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  Diff
                </button>
              )}
            </div>
          )}

          {/* Close/Open Editor Button */}
          {onToggleEditor && (
            <button
              className="unified-btn no-drag"
              onClick={onToggleEditor}
              title={isEditorOpen ? "Close Editor (Ctrl+E)" : "Open Editor (Ctrl+E)"}
              style={{ width: 24, height: 24, padding: 0, borderRadius: 9999 }}
            >
              {isEditorOpen ? <PanelRightClose size={13} /> : <PanelRight size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* 3-Dot More / Settings Dropdown Menu (Antigravity Style) */}
      {moreMenuAnchor && (
        <ContextMenu
          x={moreMenuAnchor.x}
          y={moreMenuAnchor.y}
          items={[
            {
              id: "settings",
              label: "Settings",
              shortcut: "Ctrl+,",
              icon: <Settings size={14} />,
              onClick: onOpenSettings,
            },
            { id: "d_session", divider: true },
            ...(session && onRenameSession
              ? [
                  {
                    id: "rename_session",
                    label: "Rename Session",
                    icon: <Edit3 size={14} />,
                    onClick: async () => {
                      const newTitle = await appPrompt({
                        title: "Rename Session",
                        defaultValue: session.title,
                        placeholder: "Session title...",
                        confirmLabel: "Rename",
                      });
                      if (newTitle && newTitle.trim()) {
                        onRenameSession(session.id, newTitle.trim());
                      }
                    },
                  },
                ]
              : []),
            {
              id: "new_session",
              label: "New Session",
              shortcut: "Ctrl+T",
              icon: <Plus size={14} />,
              onClick: onNewSession,
            },
            { id: "d_ws", divider: true },
            {
              id: "switch_ws",
              label: "Switch Workspace...",
              icon: <FolderTree size={14} />,
              onClick: () => {
                if (workspaceBtnRef.current) {
                  setWorkspaceAnchorRect(workspaceBtnRef.current.getBoundingClientRect());
                }
                setIsWorkspaceDropdownOpen(true);
              },
            },
            ...(onOpenCommandPalette
              ? [
                  {
                    id: "command_palette",
                    label: "Command Palette",
                    shortcut: "Ctrl+K",
                    icon: <Search size={14} />,
                    onClick: onOpenCommandPalette,
                  },
                ]
              : []),
            ...(onReindex
              ? [
                  {
                    id: "refresh_ws",
                    label: "Refresh Workspace",
                    icon: <RefreshCw size={14} />,
                    onClick: onReindex,
                  },
                ]
              : []),
          ]}
          onClose={() => setMoreMenuAnchor(null)}
        />
      )}

      {/* Workspace Switcher Floating Dropdown Window */}
      {isWorkspaceDropdownOpen && (
        <WorkspaceDropdown
          currentWorkspace={workspace}
          anchorRect={workspaceAnchorRect}
          isOpen={isWorkspaceDropdownOpen}
          onClose={() => setIsWorkspaceDropdownOpen(false)}
          onSwitchWorkspace={(folderPath, options) => {
            if (onSwitchWorkspace) {
              onSwitchWorkspace(folderPath, options);
            } else {
              window.oro?.switchWorkspace?.(folderPath, options);
            }
          }}
          onNewWorkspace={onNewWorkspace}
        />
      )}

      {/* Session Tab Right-Click Context Menu */}
      {sessionContextMenu && (
        <ContextMenu
          x={sessionContextMenu.x}
          y={sessionContextMenu.y}
          items={[
            {
              id: "configure_session",
              label: "Configure Session...",
              icon: <Sliders size={14} />,
              onClick: () => {
                onConfigureSession?.(sessionContextMenu.session);
              },
            },
            {
              id: "rename_session",
              label: "Rename",
              icon: <Edit3 size={14} />,
              onClick: () => {
                setEditingSessionId(sessionContextMenu.session.id);
                setEditingTitle(sessionContextMenu.session.title);
              },
            },
            {
              id: "new_session",
              label: "New Session",
              shortcut: "Ctrl+T",
              icon: <Plus size={14} />,
              onClick: onNewSession,
            },
            {
              id: "copy_session_id",
              label: "Copy Session ID",
              icon: <Copy size={14} />,
              onClick: () => {
                navigator.clipboard.writeText(sessionContextMenu.session.id);
              },
            },
            ...(sessions.length > 1 && onCloseSession
              ? [
                  { id: "d_close", divider: true },
                  {
                    id: "close_session",
                    label: "Close Session",
                    danger: true,
                    icon: <Trash2 size={14} />,
                    onClick: () => {
                      onCloseSession(sessionContextMenu.session.id);
                    },
                  },
                ]
              : []),
          ]}
          onClose={() => setSessionContextMenu(null)}
        />
      )}
    </div>
  );
};
