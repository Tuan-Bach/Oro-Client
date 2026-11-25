import React, { useEffect, useRef, useState } from "react";
import { FolderOpen, FolderPlus, Clock, Check, ChevronRight, ArrowLeft } from "lucide-react";
import type { WorkspaceSummary } from "../../ipc-types.js";

interface WorkspaceDropdownProps {
  currentWorkspace: WorkspaceSummary | null;
  anchorRect: DOMRect | null;
  isOpen: boolean;
  onClose: () => void;
  onSwitchWorkspace: (folderPath: string, options?: { seedStarter?: boolean }) => void;
  onNewWorkspace?: () => void;
}

export const WorkspaceDropdown: React.FC<WorkspaceDropdownProps> = ({
  currentWorkspace,
  anchorRect,
  isOpen,
  onClose,
  onSwitchWorkspace,
  onNewWorkspace,
}) => {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [recents, setRecents] = useState<Array<{ path: string; name: string; lastOpenedAt: string }>>([]);
  const [view, setView] = useState<"menu" | "create">("menu");
  const [newName, setNewName] = useState("");
  const [parentDir, setParentDir] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setView("menu");
      setNewName("");
      if (currentWorkspace?.root) {
        const parts = currentWorkspace.root.replace(/\\/g, "/").split("/");
        parts.pop();
        setParentDir(parts.join("/") || currentWorkspace.root);
      }
      window.oro?.getRecentWorkspaces?.().then((list) => {
        if (list && Array.isArray(list)) {
          setRecents(list);
        }
      }).catch(console.error);
    }
  }, [isOpen, currentWorkspace?.root]);

  // Click outside and Escape key handling
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !anchorRect) return null;

  const currentRoot = currentWorkspace?.root || "";
  const dropdownWidth = 330;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;

  // Screen overflow adjustments
  if (left + dropdownWidth > window.innerWidth - 12) {
    left = Math.max(12, window.innerWidth - dropdownWidth - 12);
  }

  const handleOpenExisting = async () => {
    onClose();
    try {
      const selected = await window.oro.selectWorkspaceFolder();
      if (selected) {
        onSwitchWorkspace(selected);
      }
    } catch (err) {
      console.error("Open workspace failed:", err);
    }
  };

  const handleCreateNew = () => {
    setView("create");
  };

  const handleConfirmCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newName.trim().replace(/[<>:"/\\|?*]/g, "");
    if (!cleanName || !parentDir || isCreating) return;
    setIsCreating(true);
    try {
      const sep = parentDir.includes("\\") ? "\\" : "/";
      const targetPath = `${parentDir.replace(/[/\\]+$/, "")}${sep}${cleanName}`;
      onClose();
      await onSwitchWorkspace(targetPath, { seedStarter: false });
    } catch (err) {
      console.error("Create workspace failed:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleSelectRecent = async (path: string) => {
    const normTarget = path.replace(/\\/g, "/").toLowerCase();
    const normCurrent = currentRoot.replace(/\\/g, "/").toLowerCase();
    onClose();
    if (normTarget !== normCurrent) {
      try {
        await onSwitchWorkspace(path);
      } catch (err) {
        console.error("Failed to switch recent workspace:", err);
      }
    }
  };

  return (
    <div
      ref={dropdownRef}
      className="oro-context-menu workspace-dropdown-window"
      role="dialog"
      aria-label="Workspace Switcher"
      style={{
        position: "fixed",
        left,
        top,
        width: dropdownWidth,
        maxHeight: "80vh",
        zIndex: 99999,
        background: "var(--modal-bg)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45), 0 2px 10px rgba(0, 0, 0, 0.25)",
        padding: "8px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        userSelect: "none",
        fontFamily: "var(--system-font)",
        animation: "dropdown-fade-in 160ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Current Workspace Pill / Info */}
      <div
        style={{
          padding: "8px 10px",
          background: "var(--hover-overlay)",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {currentWorkspace?.name || "Current Workspace"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              padding: "1px 6px",
              borderRadius: 9999,
              background: "var(--accent-soft)",
              color: "var(--text)",
              border: "1px solid var(--border)",
            }}
          >
            Active
          </span>
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-subtle)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={currentRoot}
        >
          {currentRoot}
        </div>
      </div>

      {/* Inline Create New Workspace View */}
      {view === "create" ? (
        <form onSubmit={handleConfirmCreate} style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              type="button"
              onClick={() => setView("menu")}
              className="unified-btn"
              style={{ width: 24, height: 24, padding: 0, borderRadius: 6 }}
              title="Back"
            >
              <ArrowLeft size={13} />
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>New Workspace</span>
          </div>

          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Workspace name..."
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "7px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg-surface)",
              color: "var(--text)",
              fontSize: 12,
              outline: "none",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "4px 6px", borderRadius: 7, background: "var(--hover-overlay)" }}>
            <span
              style={{ fontSize: 10.5, color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
              title={parentDir}
            >
              {parentDir}
            </span>
            <button
              type="button"
              onClick={async () => {
                const picked = await window.oro.selectWorkspaceFolder().catch(() => null);
                if (picked) setParentDir(picked);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--cyan)",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                padding: "2px 4px",
                flexShrink: 0,
              }}
            >
              Change
            </button>
          </div>

          <button
            type="submit"
            disabled={!newName.trim() || isCreating}
            className="unified-btn active"
            style={{
              width: "100%",
              height: 30,
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              justifyContent: "center",
              opacity: !newName.trim() || isCreating ? 0.5 : 1,
            }}
          >
            {isCreating ? "Creating..." : "Create & Open"}
          </button>
        </form>
      ) : (
        <>
      {/* Primary Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button
          type="button"
          className="context-menu-item"
          onClick={handleOpenExisting}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 10px",
            background: "transparent",
            border: "none",
            borderRadius: 8,
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            boxSizing: "border-box",
            transition: "background 0.12s ease",
          }}
        >
          <FolderOpen size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Open Existing Workspace...</span>
          <ChevronRight size={12} style={{ opacity: 0.4 }} />
        </button>

        <button
          type="button"
          className="context-menu-item"
          onClick={handleCreateNew}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 10px",
            background: "transparent",
            border: "none",
            borderRadius: 8,
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            boxSizing: "border-box",
            transition: "background 0.12s ease",
          }}
        >
          <FolderPlus size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Create New Workspace...</span>
          <ChevronRight size={12} style={{ opacity: 0.4 }} />
        </button>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "var(--border)", margin: "3px 4px" }} />

      {/* Recent Workspaces Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px 2px 8px",
          fontSize: 10.5,
          fontWeight: 600,
          color: "var(--text-subtle)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        <Clock size={11} style={{ opacity: 0.7 }} />
        <span>Recent Workspaces</span>
      </div>

      {/* Recent Workspaces List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          maxHeight: 210,
          overflowY: "auto",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--border) transparent",
          paddingRight: 2,
        }}
      >
        {recents.length === 0 ? (
          <div
            style={{
              padding: "10px 8px",
              textAlign: "center",
              fontSize: 11,
              color: "var(--text-subtle)",
            }}
          >
            No recent workspaces found
          </div>
        ) : (
          recents.map((item) => {
            const isCurrent = item.path.replace(/\\/g, "/").toLowerCase() === currentRoot.replace(/\\/g, "/").toLowerCase();
            return (
              <button
                key={item.path}
                type="button"
                className={`context-menu-item ${isCurrent ? "active-item" : ""}`}
                onClick={() => handleSelectRecent(item.path)}
                title={item.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px",
                  background: isCurrent ? "var(--hover-overlay)" : "transparent",
                  border: "none",
                  borderRadius: 7,
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                  boxSizing: "border-box",
                  transition: "background 0.12s ease",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11.5,
                      fontWeight: isCurrent ? 600 : 500,
                      color: isCurrent ? "var(--text)" : "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.name || item.path.split(/[/\\]/).pop() || item.path}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-subtle)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      opacity: 0.75,
                    }}
                  >
                    {item.path}
                  </div>
                </div>

                {isCurrent && (
                  <Check size={12} style={{ color: "var(--text)", opacity: 0.8, flexShrink: 0 }} />
                )}
              </button>
            );
          })
        )}
      </div>
        </>
      )}
    </div>
  );
};
