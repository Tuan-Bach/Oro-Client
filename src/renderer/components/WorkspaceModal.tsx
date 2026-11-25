import React, { useEffect, useState } from "react";
import { Folder, FolderPlus, FolderOpen, X, Clock, Sparkles, ArrowRight, Check } from "lucide-react";

interface WorkspaceModalProps {
  currentRoot: string;
  onClose: () => void;
  onSwitch: (folderPath: string, options?: { seedStarter?: boolean }) => void;
  initialTab?: "open" | "create";
}

function getParentDir(dir: string): string {
  const normalized = dir.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash > 0) {
    return normalized.substring(0, lastSlash);
  }
  return normalized;
}

function joinPath(parent: string, child: string): string {
  const cleanParent = parent.replace(/\\/g, "/").replace(/\/+$/, "");
  const cleanChild = child.replace(/^[/\\]+/, "").trim();
  return `${cleanParent}/${cleanChild}`;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  currentRoot,
  onClose,
  onSwitch,
  initialTab = "open",
}) => {
  const [tab, setTab] = useState<"open" | "create">(initialTab);
  const [recents, setRecents] = useState<Array<{ path: string; name: string; lastOpenedAt: string }>>([]);
  
  // Create New Workspace state
  const [workspaceName, setWorkspaceName] = useState("");
  const [parentDir, setParentDir] = useState(() => getParentDir(currentRoot));
  const [seedStarter, setSeedStarter] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.oro.getRecentWorkspaces().then(setRecents);
  }, []);

  // Keyboard shortcut: Escape to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleBrowseFolder = async () => {
    const selected = await window.oro.selectWorkspaceFolder();
    if (selected) {
      onSwitch(selected);
      onClose();
    }
  };

  const handleBrowseParentDir = async () => {
    const selected = await window.oro.selectWorkspaceFolder();
    if (selected) {
      setParentDir(selected);
    }
  };

  const handleCreateWorkspace = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = workspaceName.trim();
    if (!cleanName) {
      setError("Please enter a workspace name");
      return;
    }
    if (/[\\/:*?"<>|]/.test(cleanName)) {
      setError('Workspace name cannot contain \\ / : * ? " < > |');
      return;
    }
    const targetPath = joinPath(parentDir, cleanName);
    onSwitch(targetPath, { seedStarter });
    onClose();
  };

  const previewPath = workspaceName.trim() ? joinPath(parentDir, workspaceName.trim()) : "";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ fontWeight: 550, fontSize: 13, display: "flex", alignItems: "center", gap: 7, color: "var(--text)" }}>
            <Folder size={14} style={{ color: "var(--cyan)" }} />
            <span>Workspace & Knowledge Vault</span>
          </div>
          <button className="unified-btn" onClick={onClose} style={{ width: 22, height: 22, padding: 0 }}>
            <X size={13} />
          </button>
        </div>

        {/* Tab Switcher: Open Existing vs Create New */}
        <div style={{ padding: "12px 16px 0 16px" }}>
          <div
            style={{
              display: "flex",
              background: "var(--hover-overlay)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: 2,
              gap: 2,
            }}
          >
            <button
              type="button"
              className={`unified-btn ${tab === "open" ? "active" : ""}`}
              onClick={() => {
                setTab("open");
                setError(null);
              }}
              style={{
                flex: 1,
                justifyContent: "center",
                height: 26,
                fontSize: 11.5,
                fontWeight: tab === "open" ? 550 : 450,
                background: tab === "open" ? "var(--modal-bg)" : "transparent",
                color: tab === "open" ? "var(--text)" : "var(--text-muted)",
                borderRadius: 6,
                boxShadow: tab === "open" ? "0 1px 3px rgba(0, 0, 0, 0.12)" : "none",
                gap: 5,
              }}
            >
              <FolderOpen size={12} />
              <span>Open Existing</span>
            </button>
            <button
              type="button"
              className={`unified-btn ${tab === "create" ? "active" : ""}`}
              onClick={() => {
                setTab("create");
                setError(null);
              }}
              style={{
                flex: 1,
                justifyContent: "center",
                height: 26,
                fontSize: 11.5,
                fontWeight: tab === "create" ? 550 : 450,
                background: tab === "create" ? "var(--modal-bg)" : "transparent",
                color: tab === "create" ? "var(--text)" : "var(--text-muted)",
                borderRadius: 6,
                boxShadow: tab === "create" ? "0 1px 3px rgba(0, 0, 0, 0.12)" : "none",
                gap: 5,
              }}
            >
              <FolderPlus size={12} />
              <span>Create New Workspace</span>
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {tab === "create" ? (
            /* CREATE NEW WORKSPACE FORM */
            <form onSubmit={handleCreateWorkspace} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--text)", marginBottom: 5 }}>
                  Workspace / Vault Name
                </label>
                <input
                  type="text"
                  autoFocus
                  className="settings-text-input"
                  placeholder="e.g. My Vault, Research Brain, Project Atlas"
                  value={workspaceName}
                  onChange={(e) => {
                    setWorkspaceName(e.target.value);
                    if (error) setError(null);
                  }}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontSize: 12.5,
                    padding: "7px 10px",
                    borderRadius: 6,
                    border: error ? "1px solid var(--red)" : "1px solid var(--border)",
                    background: "var(--input-bg, rgba(255, 255, 255, 0.04))",
                    color: "var(--text)",
                    outline: "none",
                  }}
                />
                {error && (
                  <span style={{ fontSize: 11, color: "var(--red)", marginTop: 4, display: "block" }}>
                    {error}
                  </span>
                )}
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: "var(--text)" }}>
                    Create Inside Directory
                  </label>
                  <button
                    type="button"
                    className="unified-btn"
                    onClick={handleBrowseParentDir}
                    style={{ fontSize: 10.5, height: 20, padding: "0 6px" }}
                  >
                    Change…
                  </button>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    padding: "6px 9px",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    wordBreak: "break-all",
                    fontFamily: "monospace",
                  }}
                  title={parentDir}
                >
                  {parentDir}
                </div>
              </div>

              {previewPath && (
                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "rgba(56, 189, 248, 0.06)",
                    border: "1px solid rgba(56, 189, 248, 0.16)",
                    fontSize: 11,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <div style={{ color: "var(--cyan)", fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                    <Sparkles size={11} />
                    <span>New Vault Location</span>
                  </div>
                  <div style={{ color: "var(--text)", wordBreak: "break-all", fontFamily: "monospace", fontSize: 10.5 }}>
                    {previewPath}
                  </div>
                </div>
              )}

              <label
                style={{
                  fontSize: 11,
                  color: "var(--text)",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  cursor: "pointer",
                  userSelect: "none",
                  padding: "2px 0",
                }}
              >
                <input
                  type="checkbox"
                  checked={seedStarter}
                  onChange={(e) => setSeedStarter(e.target.checked)}
                  style={{ accentColor: "var(--cyan)", cursor: "pointer" }}
                />
                <span>Include sample notes & templates (Welcome, Architecture, MOC)</span>
              </label>
              <div style={{ fontSize: 10, color: "var(--text-subtle)", paddingLeft: 21, marginTop: -6 }}>
                {seedStarter
                  ? "Creates starter folders, sample notes, and Obsidian-compatible links."
                  : "Leaves the new workspace completely clean and blank."}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="unified-btn"
                  onClick={onClose}
                  style={{ fontSize: 11.5, padding: "5px 12px" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="unified-btn active"
                  disabled={!workspaceName.trim()}
                  style={{
                    fontSize: 11.5,
                    padding: "5px 14px",
                    fontWeight: 550,
                    background: "var(--accent)",
                    color: "var(--bg-canvas)",
                    opacity: !workspaceName.trim() ? 0.5 : 1,
                    cursor: !workspaceName.trim() ? "not-allowed" : "pointer",
                    gap: 5,
                  }}
                >
                  <span>Create & Launch</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </form>
          ) : (
            /* OPEN EXISTING WORKSPACE */
            <>
              {/* Action to open system folder dialog */}
              <button
                type="button"
                className="unified-btn"
                onClick={handleBrowseFolder}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "9px 0",
                  fontSize: 12.5,
                  fontWeight: 450,
                  background: "rgba(255, 255, 255, 0.06)",
                  border: "1px solid rgba(255, 255, 255, 0.10)",
                  color: "var(--text)",
                  borderRadius: 8,
                  gap: 6,
                }}
              >
                <FolderOpen size={14} />
                <span>Choose Any Folder from Disk…</span>
              </button>

              {/* Recent Workspaces */}
              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--text-muted)",
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Clock size={12} />
                  <span>Recent Workspaces</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
                  {recents.map((w) => {
                    const isCurrent = w.path.toLowerCase() === currentRoot.toLowerCase();
                    return (
                      <div
                        key={w.path}
                        onClick={() => {
                          if (!isCurrent) {
                            onSwitch(w.path);
                            onClose();
                          }
                        }}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: isCurrent ? "1px solid rgba(255, 255, 255, 0.16)" : "1px solid var(--border)",
                          background: isCurrent ? "rgba(255, 255, 255, 0.05)" : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: isCurrent ? "default" : "pointer",
                          transition: "all 0.12s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!isCurrent) e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.04)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isCurrent) e.currentTarget.style.backgroundColor = "transparent";
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: isCurrent ? 500 : 400,
                              color: isCurrent ? "var(--text)" : "var(--text-muted)",
                            }}
                          >
                            {w.name}{" "}
                            {isCurrent && (
                              <span style={{ fontSize: 10.5, color: "var(--green)", marginLeft: 4 }}>● Active</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-subtle)", marginTop: 2 }}>{w.path}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
