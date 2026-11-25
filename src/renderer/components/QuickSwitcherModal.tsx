import React, { useEffect, useRef, useState, useMemo } from "react";
import {
  Search,
  FileText,
  MessageSquare,
  X,
  Sparkles,
  Command,
  Moon,
  Sun,
  Palette,
  Settings,
  FolderOpen,
  FolderPlus,
  PanelLeft,
  Maximize2,
  ExternalLink,
  Plus,
} from "lucide-react";
import type { AgentModeId, SessionRecord, TreeNode } from "../../types.js";

export interface QuickSwitcherProps {
  sessions: SessionRecord[];
  activeSessionId: string | null;
  tree: TreeNode[];
  onOpenFile: (path: string) => void;
  onSwitchSession: (id: string) => void;
  onClose: () => void;
  onNewSession?: () => void;
  onNewNote?: () => void;
  onToggleTheme?: () => void;
  onOpenSettings?: () => void;
  onSelectMode?: (mode: AgentModeId) => void;
  onDistill?: () => void;
  onCompact?: () => void;
  onToggleSidebar?: () => void;
  onToggleEditor?: () => void;
  onToggleZen?: () => void;
  onReindex?: () => void;
  onOpenExternal?: () => void;
  onSwitchWorkspace?: () => void;
  onNewWorkspace?: () => void;
  currentTheme?: "dark" | "light" | "monokai";
}

interface PaletteItem {
  id: string;
  type: "command" | "session" | "note";
  category: "Commands" | "Notes" | "Sessions";
  title: string;
  subtitle: string;
  shortcut?: string;
  icon: React.ReactNode;
  action: () => void;
}

function extractAllNotes(nodes: TreeNode[]): Array<{ path: string; name: string }> {
  const list: Array<{ path: string; name: string }> = [];
  for (const n of nodes) {
    if (!n.isDir) {
      list.push({ path: n.path, name: n.name });
    }
    if (n.children) {
      list.push(...extractAllNotes(n.children));
    }
  }
  return list;
}

export const QuickSwitcherModal: React.FC<QuickSwitcherProps> = ({
  sessions,
  activeSessionId,
  tree,
  onOpenFile,
  onSwitchSession,
  onClose,
  onNewSession,
  onNewNote,
  onToggleTheme,
  onOpenSettings,
  onSelectMode,
  onDistill,
  onCompact,
  onToggleSidebar,
  onToggleEditor,
  onToggleZen,
  onReindex,
  onOpenExternal,
  onSwitchWorkspace,
  onNewWorkspace,
  currentTheme = "dark",
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const allNotes = useMemo(() => extractAllNotes(tree), [tree]);

  // Build the universal catalogue of items
  const allItems = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // --- 1. SYSTEM COMMANDS ---
    if (onNewSession) {
      list.push({
        id: "cmd_new_session",
        type: "command",
        category: "Commands",
        title: "New Chat Session",
        subtitle: "Start a fresh conversation with Oro AI",
        shortcut: "Ctrl+N",
        icon: <Plus size={13} style={{ color: "var(--cyan)" }} />,
        action: () => {
          onNewSession();
          onClose();
        },
      });
    }

    if (onCompact) {
      list.push({
        id: "cmd_compact_context",
        type: "command",
        category: "Commands",
        title: "Compact Context (/compact)",
        subtitle: "Summarize and condense current session history",
        icon: <Sparkles size={13} style={{ color: "#a855f7" }} />,
        action: () => {
          onCompact();
          onClose();
        },
      });
    }

    if (onToggleEditor) {
      list.push({
        id: "cmd_toggle_editor",
        type: "command",
        category: "Commands",
        title: "Toggle Editor Panel",
        subtitle: "Show or hide the code & markdown editor",
        shortcut: "Ctrl+E",
        icon: <Maximize2 size={13} style={{ color: "var(--cyan)" }} />,
        action: () => {
          onToggleEditor();
          onClose();
        },
      });
    }

    if (onReindex) {
      list.push({
        id: "cmd_reindex_vault",
        type: "command",
        category: "Commands",
        title: "Reindex Workspace",
        subtitle: "Refresh files, wiki-links, and FTS5 search index",
        icon: <Command size={13} style={{ color: "var(--text-muted)" }} />,
        action: () => {
          onReindex();
          onClose();
        },
      });
    }

    if (onToggleTheme) {
      const nextThemeLabel = currentTheme === "dark" ? "Light" : currentTheme === "light" ? "Monokai" : "Dark";
      list.push({
        id: "cmd_toggle_theme",
        type: "command",
        category: "Commands",
        title: `Switch to ${nextThemeLabel} Theme`,
        subtitle: "Change application color scheme",
        icon: currentTheme === "dark" ? <Sun size={13} style={{ color: "#eab308" }} /> : currentTheme === "light" ? <Palette size={13} style={{ color: "#a6e22e" }} /> : <Moon size={13} style={{ color: "#38bdf8" }} />,
        action: () => {
          onToggleTheme();
          onClose();
        },
      });
    }

    if (onOpenSettings) {
      list.push({
        id: "cmd_open_settings",
        type: "command",
        category: "Commands",
        title: "Open Settings",
        subtitle: "AI provider, models, effort, theme & typography",
        shortcut: "Ctrl+,",
        icon: <Settings size={13} style={{ color: "var(--text-muted)" }} />,
        action: () => {
          onOpenSettings();
          onClose();
        },
      });
    }

    if (onDistill) {
      list.push({
        id: "cmd_distill",
        type: "command",
        category: "Commands",
        title: "Distill Session Knowledge",
        subtitle: "Extract key insights and decisions into your second brain",
        icon: <Sparkles size={13} style={{ color: "var(--cyan)" }} />,
        action: () => {
          onDistill();
          onClose();
        },
      });
    }

    if (onToggleSidebar) {
      list.push({
        id: "cmd_toggle_sidebar",
        type: "command",
        category: "Commands",
        title: "Toggle File Explorer Sidebar",
        subtitle: "Show or hide the left file tree navigation drawer",
        shortcut: "Ctrl+B",
        icon: <PanelLeft size={13} style={{ color: "var(--text-muted)" }} />,
        action: () => {
          onToggleSidebar();
          onClose();
        },
      });
    }

    if (onToggleZen) {
      list.push({
        id: "cmd_toggle_zen",
        type: "command",
        category: "Commands",
        title: "Toggle Zen / Focus Mode",
        subtitle: "Maximize the active panel and hide all chrome",
        shortcut: "Ctrl+Shift+Z",
        icon: <Maximize2 size={13} style={{ color: "var(--text-muted)" }} />,
        action: () => {
          onToggleZen();
          onClose();
        },
      });
    }

    if (onOpenExternal) {
      list.push({
        id: "cmd_open_external",
        type: "command",
        category: "Commands",
        title: "Open Active Note in VS Code / External Editor",
        subtitle: "Launch current file in your default OS editor",
        icon: <ExternalLink size={13} style={{ color: "var(--text-muted)" }} />,
        action: () => {
          onOpenExternal();
          onClose();
        },
      });
    }

    if (onSwitchWorkspace) {
      list.push({
        id: "cmd_switch_vault",
        type: "command",
        category: "Commands",
        title: "Switch Workspace Vault Folder",
        subtitle: "Select a different second brain vault on disk",
        icon: <FolderOpen size={13} style={{ color: "var(--text-muted)" }} />,
        action: () => {
          onSwitchWorkspace();
          onClose();
        },
      });
    }

    if (onNewWorkspace) {
      list.push({
        id: "cmd_new_workspace",
        type: "command",
        category: "Commands",
        title: "Create New Workspace Vault",
        subtitle: "Initialize a new second brain vault folder with starter notes",
        icon: <FolderPlus size={13} style={{ color: "var(--cyan)" }} />,
        action: () => {
          onNewWorkspace();
          onClose();
        },
      });
    }

    // --- 2. CHAT SESSIONS ---
    for (const s of sessions) {
      list.push({
        id: `sess_${s.id}`,
        type: "session",
        category: "Sessions",
        title: s.title,
        subtitle: `Chat Session (${s.mode})`,
        icon: <MessageSquare size={13} style={{ color: "#c084fc" }} />,
        action: () => {
          onSwitchSession(s.id);
          onClose();
        },
      });
    }

    // --- 3. NOTES & FILES ---
    for (const n of allNotes) {
      list.push({
        id: `note_${n.path}`,
        type: "note",
        category: "Notes",
        title: n.name,
        subtitle: n.path,
        icon: <FileText size={13} style={{ color: "var(--cyan)" }} />,
        action: () => {
          onOpenFile(n.path);
          onClose();
        },
      });
    }

    return list;
  }, [
    sessions,
    allNotes,
    currentTheme,
    onNewSession,
    onToggleTheme,
    onOpenSettings,
    onSelectMode,
    onDistill,
    onToggleSidebar,
    onToggleZen,
    onOpenExternal,
    onSwitchWorkspace,
    onOpenFile,
    onSwitchSession,
    onClose,
  ]);

  // Filter based on input
  const filtered = useMemo(() => {
    const raw = query.trim();
    if (!raw) return allItems;

    // Command prefix mode: ">"
    if (raw.startsWith(">")) {
      const term = raw.slice(1).trim().toLowerCase();
      return allItems.filter(
        (item) =>
          item.type === "command" &&
          (item.title.toLowerCase().includes(term) || item.subtitle.toLowerCase().includes(term))
      );
    }

    // Note prefix mode: "#"
    if (raw.startsWith("#")) {
      const term = raw.slice(1).trim().toLowerCase();
      return allItems.filter(
        (item) =>
          item.type === "note" &&
          (item.title.toLowerCase().includes(term) || item.subtitle.toLowerCase().includes(term))
      );
    }

    // Session prefix mode: "@"
    if (raw.startsWith("@")) {
      const term = raw.slice(1).trim().toLowerCase();
      return allItems.filter(
        (item) =>
          item.type === "session" &&
          (item.title.toLowerCase().includes(term) || item.subtitle.toLowerCase().includes(term))
      );
    }

    // Default: search all categories
    const term = raw.toLowerCase();
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(term) ||
        item.subtitle.toLowerCase().includes(term) ||
        (item.shortcut && item.shortcut.toLowerCase().includes(term))
    );
  }, [allItems, query]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const safeIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
      if (filtered[safeIndex]) {
        filtered[safeIndex]!.action();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ alignItems: "flex-start", paddingTop: "12vh" }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "92%",
          maxWidth: 540,
          borderRadius: 14,
          background: "var(--modal-bg, #161e2c)",
          border: "1px solid var(--border)",
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45)",
          overflow: "hidden",
          padding: 0,
        }}
      >
        {/* Search Bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <Search size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search notes & sessions… (type > for commands)"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          {query ? (
            <button
              onClick={() => {
                setQuery("");
                setSelectedIndex(0);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                display: "flex",
                padding: 2,
              }}
            >
              <X size={13} />
            </button>
          ) : (
            <kbd
              style={{
                fontSize: 10,
                opacity: 0.7,
                background: "var(--hover-overlay)",
                padding: "2px 5px",
                borderRadius: 4,
                color: "var(--text-subtle)",
              }}
            >
              Esc
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div style={{ maxHeight: 360, overflowY: "auto", padding: "6px 8px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "28px 16px", textAlign: "center", fontSize: 12, color: "var(--text-subtle)" }}>
              No matches found for "{query}"
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === selectedIndex;
              const isCurrentSession = item.type === "session" && item.id === `sess_${activeSessionId}`;

              return (
                <div
                  key={item.id}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(index)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 10px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: isSelected ? "var(--active-overlay)" : "transparent",
                    transition: "all 0.1s ease",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
                    <div style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
                      {item.icon}
                    </div>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: isSelected ? 550 : 400,
                        color: isSelected ? "var(--text)" : "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.title}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {item.shortcut ? (
                      <kbd
                        style={{
                          fontSize: 9.5,
                          padding: "2px 5px",
                          borderRadius: 4,
                          background: "var(--hover-overlay)",
                          color: "var(--text-subtle)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        {item.shortcut}
                      </kbd>
                    ) : item.subtitle ? (
                      <span
                        style={{
                          fontSize: 10.5,
                          color: "var(--text-subtle)",
                          maxWidth: 150,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.subtitle}
                      </span>
                    ) : null}

                    {isCurrentSession && (
                      <span
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background: "var(--hover-overlay)",
                          color: "var(--green)",
                          fontWeight: 500,
                        }}
                      >
                        Active
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hint */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderTop: "1px solid var(--border-subtle)",
            fontSize: 10.5,
            color: "var(--text-subtle)",
            background: "rgba(255, 255, 255, 0.015)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span><strong style={{ color: "var(--text-muted)" }}>↑↓</strong> navigate</span>
            <span><strong style={{ color: "var(--text-muted)" }}>↵</strong> run</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span><strong style={{ color: "var(--text-muted)" }}>&gt;</strong> commands</span>
            <span><strong style={{ color: "var(--text-muted)" }}>#</strong> notes</span>
            <span><strong style={{ color: "var(--text-muted)" }}>@</strong> sessions</span>
          </div>
        </div>
      </div>
    </div>
  );
};
