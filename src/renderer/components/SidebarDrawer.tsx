import React, { useState, useRef, useMemo, useEffect } from "react";
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  File,
  FileJson,
  Image as ImageIcon,
  Search,
  Plus,
  RefreshCw,
  FolderPlus,
  FilePlus,
  Copy,
  ExternalLink,
  Trash2,
  Edit3,
  Files,
  FolderSearch,
  X,
  Filter,
  ChevronDown,
  PanelLeftClose,
} from "lucide-react";
import type { TaskRecord, MemoryRecord, TreeNode } from "../../types.js";
import type { WorkspaceSummary } from "../../ipc-types.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { PromptModal } from "./PromptModal.js";
import { appConfirm } from "./AppDialog.js";
import { processDroppedDataTransfer } from "../utils/fileDropHelper.js";

interface SidebarDrawerProps {
  tree: TreeNode[];
  tasks?: TaskRecord[];
  memories?: MemoryRecord[];
  workspace?: WorkspaceSummary | null;
  workspaceRoot?: string;
  activeFilePath: string | null;
  sessions?: any[];
  activeSessionId?: string | null;
  onSelectSession?: (s: any) => void;
  onNewSession?: () => void;
  onCloseSession?: (id: string) => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  onOpenWorkspacePicker?: () => void;
  onNewWorkspace?: () => void;
  onPreviewFile?: (relPath: string) => void;
  onOpenFile: (relPath: string) => void;
  onMovePath?: (from: string, to: string) => Promise<any>;
  onToggleTask?: (id: number) => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  isReindexing?: boolean;
  onReindex: () => void;
  onDeletePath?: (relPath: string) => Promise<void>;
}

function getFileIcon(ext: string) {
  const e = ext.toLowerCase();
  if (e === "md" || e === "markdown" || e === "txt") {
    return <FileText size={12.5} style={{ color: "var(--text-muted)", flexShrink: 0, opacity: 0.85 }} />;
  }
  if (["ts", "tsx", "js", "jsx", "py", "sh", "bat", "ps1", "bash", "css", "html"].includes(e)) {
    return <FileCode size={12.5} style={{ color: "var(--text-subtle)", flexShrink: 0, opacity: 0.7 }} />;
  }
  if (e === "json") {
    return <FileJson size={12.5} style={{ color: "var(--text-subtle)", flexShrink: 0, opacity: 0.7 }} />;
  }
  if (["png", "jpg", "jpeg", "svg", "gif", "webp", "ico"].includes(e)) {
    return <ImageIcon size={12.5} style={{ color: "var(--text-subtle)", flexShrink: 0, opacity: 0.7 }} />;
  }
  return <File size={12.5} style={{ color: "var(--text-subtle)", flexShrink: 0, opacity: 0.6 }} />;
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  tree,
  tasks,
  memories,
  workspace,
  activeFilePath,
  workspaceRoot,
  onToggleSidebar,
  onOpenWorkspacePicker,
  onNewWorkspace,
  onPreviewFile,
  onOpenFile,
  onMovePath,
  onToggleTask,
  onNewFile,
  onNewFolder,
  isReindexing = false,
  onReindex,
  onDeletePath,
}) => {
  // Context Menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "file" | "folder" | "canvas" | "session";
    targetPath?: string;
  } | null>(null);

  // Prompt state for in-folder new file/folder and rename
  const [promptState, setPromptState] = useState<{
    type: "file" | "folder" | "rename";
    initialValue?: string;
    targetDir?: string;
    targetPath?: string;
  } | null>(null);

  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["Notes", "Research", "Projects", "Concepts", "Inbox", "Sessions", "src"])
  );
  const [treeFilter, setTreeFilter] = useState("");

  // Press F2 to quickly rename the active file in the sidebar
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "F2" || !activeFilePath) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      setPromptState({
        type: "rename",
        targetPath: activeFilePath,
        initialValue: activeFilePath.split("/").pop() || activeFilePath,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeFilePath]);

  const filterTreeNodes = (nodes: TreeNode[], q: string): TreeNode[] => {
    const term = q.trim().toLowerCase();
    if (!term) return nodes;
    const out: TreeNode[] = [];
    for (const n of nodes) {
      if (n.isDir) {
        const filteredChildren = n.children ? filterTreeNodes(n.children, term) : [];
        if (n.name.toLowerCase().includes(term) || filteredChildren.length > 0) {
          out.push({ ...n, children: filteredChildren });
        }
      } else if (n.name.toLowerCase().includes(term) || n.path.toLowerCase().includes(term)) {
        out.push(n);
      }
    }
    return out;
  };

  const displayedTree = treeFilter.trim() ? filterTreeNodes(tree, treeFilter) : tree;
  const [isSidebarDraggingOver, setIsSidebarDraggingOver] = useState(false);
  const [isInternalDragging, setIsInternalDragging] = useState(false);
  const [dragHoverFolder, setDragHoverFolder] = useState<string | null>(null);
  const [mouseHoverFolder, setMouseHoverFolder] = useState<string | null>(null);
  const sidebarDragCounterRef = useRef(0);

  // Clear internal dragging and counters on window dragend/drop to avoid stuck overlay states
  useEffect(() => {
    const handleDragEnd = () => {
      sidebarDragCounterRef.current = 0;
      setIsInternalDragging(false);
      setIsSidebarDraggingOver(false);
      setDragHoverFolder(null);
    };
    window.addEventListener("dragend", handleDragEnd);
    window.addEventListener("drop", handleDragEnd);
    return () => {
      window.removeEventListener("dragend", handleDragEnd);
      window.removeEventListener("drop", handleDragEnd);
    };
  }, []);

  // Auto-expand folders in tree so newly created folders and files are immediately visible
  useEffect(() => {
    if (tree.length > 0) {
      setExpanded((prev) => {
        let changed = false;
        const next = new Set(prev);
        const addDirs = (nodes: TreeNode[]) => {
          for (const node of nodes) {
            if (node.isDir) {
              if (!next.has(node.path)) {
                next.add(node.path);
                changed = true;
              }
              if (node.children && node.children.length > 0) {
                addDirs(node.children);
              }
            }
          }
        };
        addDirs(tree);
        return changed ? next : prev;
      });
    }
  }, [tree]);

  const handleImportDroppedFiles = async (dt: DataTransfer, targetFolder = "") => {
    try {
      const processed = await processDroppedDataTransfer(dt);
      if (processed.length === 0) return;
      let firstDestRel = "";

      for (const item of processed) {
        const destRel = targetFolder ? `${targetFolder}/${item.name}` : item.name;
        if (!firstDestRel) firstDestRel = destRel;
        if (item.base64) {
          await window.oro.writeFile(destRel, item.base64, "base64");
        } else {
          await window.oro.writeFile(destRel, item.content, "utf8");
        }
      }

      if (targetFolder) {
        setExpanded((prev) => new Set([...prev, targetFolder]));
      }

      onReindex();
      if (firstDestRel) {
        onOpenFile(firstDestRel);
      }
    } catch (err) {
      console.error("Failed to import dropped files:", err);
    }
  };

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Context Menu action helpers
  const handleCopyPath = (relPath: string, absolute = false) => {
    let target = relPath;
    if (absolute && workspaceRoot) {
      const normalizedRoot = workspaceRoot.replace(/\\/g, "/");
      target = `${normalizedRoot}/${relPath}`;
      if (workspaceRoot.includes("\\") || navigator.userAgent.includes("Windows")) {
        target = target.replace(/\//g, "\\");
      }
    }
    navigator.clipboard.writeText(target);
  };

  const handleDuplicateFile = async (relPath: string) => {
    try {
      const file = await window.oro.readFile(relPath);
      const lastSlash = relPath.lastIndexOf("/");
      const dir = lastSlash >= 0 ? relPath.slice(0, lastSlash + 1) : "";
      const filename = lastSlash >= 0 ? relPath.slice(lastSlash + 1) : relPath;
      const lastDot = filename.lastIndexOf(".");
      const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
      const ext = lastDot > 0 ? filename.slice(lastDot) : "";

      const candidate = `${dir}${base} copy${ext}`;
      await window.oro.writeFile(candidate, file.content);
      onReindex();
      onOpenFile(candidate);
    } catch (err) {
      console.error("Duplicate failed:", err);
    }
  };

  const handleDeletePath = async (relPath: string) => {
    const isDir = tree.some((n) => {
      const check = (node: TreeNode): boolean => {
        if (node.path === relPath) return node.isDir;
        if (node.children) return node.children.some(check);
        return false;
      };
      return check(n);
    });
    const label = isDir ? "folder" : "file";
    const ok = await appConfirm({
      title: `Move ${label} to trash`,
      message: `Move "${relPath}" to trash?`,
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    try {
      if (onDeletePath) {
        await onDeletePath(relPath);
      } else {
        await window.oro.deletePath(relPath);
        onReindex();
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // Build items for current context menu
  const getContextMenuItems = (): ContextMenuItem[] => {
    if (!contextMenu) return [];
    const { type, targetPath } = contextMenu;

    if (type === "file" && targetPath) {
      return [
        {
          id: "open",
          label: "Open in Editor",
          icon: <FileText size={14} />,
          onClick: () => onOpenFile(targetPath),
        },
        {
          id: "open_external",
          label: "Open in External Editor",
          icon: <ExternalLink size={14} />,
          onClick: () => window.oro.openExternal(targetPath),
        },
        {
          id: "reveal",
          label: "Reveal in File Explorer",
          icon: <FolderSearch size={14} />,
          onClick: () => window.oro.revealInExplorer(targetPath),
        },
        { id: "d1", divider: true },
        {
          id: "copy_rel",
          label: "Copy Relative Path",
          icon: <Copy size={14} />,
          onClick: () => handleCopyPath(targetPath, false),
        },
        {
          id: "copy_abs",
          label: "Copy Absolute Path",
          icon: <Copy size={14} />,
          onClick: () => handleCopyPath(targetPath, true),
        },
        { id: "d2", divider: true },
        {
          id: "rename",
          label: "Rename...",
          shortcut: "F2",
          icon: <Edit3 size={14} />,
          onClick: () =>
            setPromptState({
              type: "rename",
              initialValue: targetPath.split("/").pop() || targetPath,
              targetPath,
            }),
        },
        {
          id: "duplicate",
          label: "Duplicate",
          icon: <Files size={14} />,
          onClick: () => handleDuplicateFile(targetPath),
        },
        { id: "d3", divider: true },
        {
          id: "delete",
          label: "Delete",
          danger: true,
          icon: <Trash2 size={14} />,
          onClick: () => handleDeletePath(targetPath),
        },
      ];
    }

    if (type === "folder" && targetPath) {
      return [
        {
          id: "new_note",
          label: "New Note in Folder...",
          icon: <FileText size={14} />,
          onClick: () =>
            setPromptState({
              type: "file",
              targetDir: targetPath,
              initialValue: "Untitled.md",
            }),
        },
        {
          id: "new_folder",
          label: "New Subfolder...",
          icon: <FolderPlus size={14} />,
          onClick: () =>
            setPromptState({
              type: "folder",
              targetDir: targetPath,
              initialValue: "new-folder",
            }),
        },
        { id: "d1", divider: true },
        {
          id: "reveal",
          label: "Reveal in File Explorer",
          icon: <FolderSearch size={14} />,
          onClick: () => window.oro.revealInExplorer(targetPath),
        },
        {
          id: "copy_path",
          label: "Copy Path",
          icon: <Copy size={14} />,
          onClick: () => handleCopyPath(targetPath, false),
        },
        { id: "d2", divider: true },
        {
          id: "rename",
          label: "Rename Folder...",
          shortcut: "F2",
          icon: <Edit3 size={14} />,
          onClick: () =>
            setPromptState({
              type: "rename",
              initialValue: targetPath.split("/").pop() || targetPath,
              targetPath,
            }),
        },
        {
          id: "delete",
          label: "Delete Folder",
          danger: true,
          icon: <Trash2 size={14} />,
          onClick: () => handleDeletePath(targetPath),
        },
      ];
    }

    // Canvas / Workspace background context menu
    return [
      {
        id: "new_note",
        label: "New Note...",
        icon: <FileText size={14} />,
        onClick: onNewFile,
      },
      {
        id: "new_folder",
        label: "New Folder...",
        icon: <FolderPlus size={14} />,
        onClick: onNewFolder,
      },
      { id: "d1", divider: true },
      {
        id: "reindex",
        label: isReindexing ? "Refreshing..." : "Refresh Workspace",
        icon: <RefreshCw size={14} className={isReindexing ? "spin" : ""} />,
        onClick: onReindex,
      },
      {
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: <FolderSearch size={14} />,
        onClick: () => window.oro.revealInExplorer(""),
      },
      {
        id: "open_external",
        label: "Open in External Editor",
        icon: <ExternalLink size={14} />,
        onClick: () => window.oro.openExternal(""),
      },
    ];
  };

  const renderTreeNodes = (nodes: TreeNode[]) => {
    return nodes.map((node) => {
      const isDir = node.isDir;
      const isOpen = expanded.has(node.path);
      const isSelected = activeFilePath === node.path;
      const cleanTitle = node.name.replace(/\.md$/, "");
      const ext = node.name.includes(".") ? node.name.split(".").pop()?.toLowerCase() || "" : "";

      if (isDir) {
        const isDragHover = dragHoverFolder === node.path;
        const isMouseHover = mouseHoverFolder === node.path && !isInternalDragging && !isSidebarDraggingOver;
        return (
          <div key={node.path}>
            <div
              draggable={true}
              onDragStart={(e) => {
                setIsInternalDragging(true);
                e.dataTransfer.setData("application/oro-folder", node.path);
                e.dataTransfer.setData("text/plain", node.path);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => {
                sidebarDragCounterRef.current = 0;
                setIsInternalDragging(false);
                setIsSidebarDraggingOver(false);
                setDragHoverFolder(null);
              }}
              onMouseEnter={() => setMouseHoverFolder(node.path)}
              onMouseLeave={() => setMouseHoverFolder(null)}
              onClick={() => toggleFolder(node.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  type: "folder",
                  targetPath: node.path,
                });
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "move";
                if (dragHoverFolder !== node.path) {
                  setDragHoverFolder(node.path);
                }
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDragHoverFolder((prev) => (prev === node.path ? null : prev));
                }
              }}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragHoverFolder(null);
                sidebarDragCounterRef.current = 0;
                setIsSidebarDraggingOver(false);
                setIsInternalDragging(false);

                // Check internal file/folder move
                const internalNote = e.dataTransfer.getData("application/oro-note");
                const internalFolder = e.dataTransfer.getData("application/oro-folder");
                const sourcePath = internalNote || internalFolder;

                if (sourcePath) {
                  const fileName = sourcePath.split("/").pop() || sourcePath;
                  const destPath = `${node.path}/${fileName}`;
                  // Prevent moving into itself or its own subfolder
                  if (sourcePath !== destPath && !node.path.startsWith(`${sourcePath}/`)) {
                    if (onMovePath) {
                      await onMovePath(sourcePath, destPath);
                    } else {
                      await window.oro.movePath(sourcePath, destPath);
                      onReindex?.();
                    }
                    setExpanded((prev) => new Set([...prev, node.path]));
                  }
                  return;
                }

                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  await handleImportDroppedFiles(e.dataTransfer, node.path);
                }
              }}
              className="sidebar-folder-item"
              style={{
                paddingLeft: node.depth * 14 + 10,
                background: isDragHover ? "var(--active-overlay)" : undefined,
                boxShadow: isDragHover ? "inset 0 0 0 1px var(--cyan)" : undefined,
                borderRadius: 4,
                transition: "background 0.12s ease",
              }}
            >
              {isOpen ? (
                <FolderOpen size={13} style={{ color: isDragHover ? "var(--cyan)" : "var(--text-subtle)", flexShrink: 0, pointerEvents: "none" }} />
              ) : (
                <Folder size={13} style={{ color: isDragHover ? "var(--cyan)" : "var(--text-subtle)", flexShrink: 0, pointerEvents: "none" }} />
              )}
              <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, pointerEvents: "none" }}>
                {node.name}
              </span>
              {/* Quick action buttons on normal mouse hover (hidden during drag-and-drop to prevent flickering) */}
              {isMouseHover && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    marginLeft: "auto",
                    paddingRight: 4,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="unified-btn"
                    title={`New Note in ${node.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPromptState({
                        type: "file",
                        targetDir: node.path,
                        initialValue: "Untitled.md",
                      });
                    }}
                    style={{ width: 18, height: 18, padding: 0, borderRadius: 4 }}
                  >
                    <FilePlus size={11} style={{ color: "var(--cyan)" }} />
                  </button>
                  <button
                    type="button"
                    className="unified-btn"
                    title={`New Subfolder in ${node.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPromptState({
                        type: "folder",
                        targetDir: node.path,
                        initialValue: "new-folder",
                      });
                    }}
                    style={{ width: 18, height: 18, padding: 0, borderRadius: 4 }}
                  >
                    <FolderPlus size={11} />
                  </button>
                </div>
              )}
            </div>
            {isOpen && (
              <div
                className="sidebar-folder-children-space"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "move";
                  if (dragHoverFolder !== node.path) {
                    setDragHoverFolder(node.path);
                  }
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragHoverFolder((prev) => (prev === node.path ? null : prev));
                  }
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragHoverFolder(null);
                  sidebarDragCounterRef.current = 0;
                  setIsSidebarDraggingOver(false);
                  setIsInternalDragging(false);

                  // Check internal file/folder move
                  const internalNote = e.dataTransfer.getData("application/oro-note");
                  const internalFolder = e.dataTransfer.getData("application/oro-folder");
                  const sourcePath = internalNote || internalFolder;

                  if (sourcePath) {
                    const fileName = sourcePath.split("/").pop() || sourcePath;
                    const destPath = `${node.path}/${fileName}`;
                    // Prevent moving into itself or its own subfolder
                    if (sourcePath !== destPath && !node.path.startsWith(`${sourcePath}/`)) {
                      if (onMovePath) {
                        await onMovePath(sourcePath, destPath);
                      } else {
                        await window.oro.movePath(sourcePath, destPath);
                        onReindex?.();
                      }
                      setExpanded((prev) => new Set([...prev, node.path]));
                    }
                    return;
                  }

                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    await handleImportDroppedFiles(e.dataTransfer, node.path);
                  }
                }}
                style={{
                  position: "relative",
                  background: isDragHover ? "rgba(56, 189, 248, 0.04)" : undefined,
                  borderLeft: isDragHover ? "1px dashed var(--cyan)" : undefined,
                  marginLeft: (node.depth || 0) * 14 + 18,
                  paddingLeft: 6,
                  transition: "background 0.12s ease",
                }}
              >
                {node.children && node.children.length > 0 && renderTreeNodes(node.children)}
                {(!node.children || node.children.length === 0) && (
                  <div
                    style={{
                      paddingLeft: 8,
                      paddingTop: 3,
                      paddingBottom: 3,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 10.5,
                      color: "var(--text-subtle)",
                      fontStyle: "italic",
                    }}
                  >
                    <span>Empty folder — drop files here</span>
                    <button
                      type="button"
                      className="unified-btn"
                      title="Create note in this folder"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPromptState({
                          type: "file",
                          targetDir: node.path,
                          initialValue: "Untitled.md",
                        });
                      }}
                      style={{ height: 18, fontSize: 10, padding: "0 6px", borderRadius: 4 }}
                    >
                      + Note
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }

      return (
        <div
          key={node.path}
          draggable={true}
          onDragStart={(e) => {
            setIsInternalDragging(true);
            e.dataTransfer.setData("application/oro-note", node.path);
            e.dataTransfer.setData("text/plain", `[[${cleanTitle}]]`);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            setIsInternalDragging(false);
            setIsSidebarDraggingOver(false);
          }}
          onClick={() => {
            if (onPreviewFile) onPreviewFile(node.path);
            else onOpenFile(node.path);
          }}
          onDoubleClick={() => onOpenFile(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              type: "file",
              targetPath: node.path,
            });
          }}
          title={`${node.name}\nClick: preview • Double click: open • Right click: options`}
          className={`sidebar-tree-item ${isSelected ? "selected" : ""}`}
          style={{
            paddingLeft: node.depth * 14 + 10,
            paddingRight: 8,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {getFileIcon(ext)}
          <span style={{ fontWeight: isSelected ? 550 : 460, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {cleanTitle}
          </span>
        </div>
      );
    });
  };

  return (
    <div
      className="sidebar-drawer"
      onDragEnter={(e) => {
        e.preventDefault();
        sidebarDragCounterRef.current += 1;
        const types = Array.from(e.dataTransfer.types || []);
        const isInternal =
          isInternalDragging ||
          types.includes("application/oro-note") ||
          types.includes("application/oro-folder");

        if (!isInternal && types.includes("Files")) {
          if (sidebarDragCounterRef.current === 1) {
            setIsSidebarDraggingOver(true);
          }
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const types = Array.from(e.dataTransfer.types || []);
        const isInternal =
          isInternalDragging ||
          types.includes("application/oro-note") ||
          types.includes("application/oro-folder");

        if (isInternal) {
          e.dataTransfer.dropEffect = "move";
        } else if (types.includes("Files")) {
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        sidebarDragCounterRef.current -= 1;
        if (sidebarDragCounterRef.current <= 0) {
          sidebarDragCounterRef.current = 0;
          setIsSidebarDraggingOver(false);
        }
      }}
      onDrop={async (e) => {
        e.preventDefault();
        sidebarDragCounterRef.current = 0;
        setIsSidebarDraggingOver(false);
        setIsInternalDragging(false);
        setDragHoverFolder(null);

        // Check internal drag to root
        const internalNote = e.dataTransfer.getData("application/oro-note");
        const internalFolder = e.dataTransfer.getData("application/oro-folder");
        const sourcePath = internalNote || internalFolder;

        if (sourcePath) {
          const fileName = sourcePath.split("/").pop() || sourcePath;
          const destPath = fileName;
          if (sourcePath !== destPath) {
            if (onMovePath) {
              await onMovePath(sourcePath, destPath);
            } else {
              await window.oro.movePath(sourcePath, destPath);
              onReindex?.();
            }
          }
          return;
        }

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          await handleImportDroppedFiles(e.dataTransfer, "");
        }
      }}
      style={{
        width: "100%",
        height: "100%",
        background: "var(--bg-canvas)",
        border: "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          type: "canvas",
        });
      }}
    >
      {/* Sidebar Root Drop Overlay - ONLY for external files dragged from outside Oro */}
      {isSidebarDraggingOver && !isInternalDragging && !dragHoverFolder && (
        <div
          style={{
            position: "absolute",
            inset: 6,
            borderRadius: 8,
            background: "var(--prompt-fade)",
            backdropFilter: "blur(4px)",
            border: "2px dashed var(--cyan)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            zIndex: 60,
            pointerEvents: "none",
          }}
        >
          <FolderPlus size={22} style={{ color: "var(--cyan)" }} />
          <span style={{ fontSize: 11.5, fontWeight: 550, color: "var(--text)" }}>
            Drop files to import into vault
          </span>
        </div>
      )}
      {/* Main Scroll Area: File Tree */}
      <div
        className="sidebar-scroll-area"
        style={{ flex: 1, overflowY: "auto", padding: "6px 4px 16px 4px" }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type: "canvas",
          });
        }}
      >
        {tree.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: "var(--hover-overlay)",
                border: "1px solid var(--border-subtle)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--cyan)",
              }}
            >
              <FolderPlus size={20} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 550, color: "var(--text)", marginBottom: 4 }}>
                Workspace is empty
              </div>
              <div style={{ fontSize: 11, color: "var(--text-subtle)", lineHeight: 1.45 }}>
                Create notes and folders to organize your thoughts, or drag and drop files here.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, width: "100%", marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onNewFile}
                style={{
                  flex: 1,
                  height: 28,
                  fontSize: 11.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <FileText size={12} />
                New Note
              </button>
              <button
                type="button"
                className="btn"
                onClick={onNewFolder}
                style={{
                  flex: 1,
                  height: 28,
                  fontSize: 11.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <FolderPlus size={12} />
                New Folder
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="sidebar-filter-wrap">
              <Search size={11} className="sidebar-filter-icon" />
              <input
                type="text"
                className="sidebar-filter-input"
                placeholder="Filter files..."
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                aria-label="Filter workspace files"
              />
              {treeFilter && (
                <button
                  type="button"
                  className="sidebar-filter-clear"
                  onClick={() => setTreeFilter("")}
                  aria-label="Clear filter"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            {displayedTree.length === 0 ? (
              <div style={{ padding: "16px 12px", fontSize: 11.5, color: "var(--text-subtle)", textAlign: "center" }}>
                No matching files
              </div>
            ) : (
              renderTreeNodes(displayedTree)
            )}
          </>
        )}
      </div>

      {/* Right-click Floating Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* In-folder New File / New Folder / Rename Modal */}
      {promptState && (
        <PromptModal
          type={promptState.type}
          initialValue={promptState.initialValue}
          title={
            promptState.type === "rename"
              ? `Rename "${promptState.targetPath?.split("/").pop()}"`
              : promptState.targetDir
              ? `New ${promptState.type === "file" ? "Note" : "Folder"} in "${promptState.targetDir}"`
              : undefined
          }
          onClose={() => setPromptState(null)}
          onSubmit={async (val) => {
            try {
              if (promptState.type === "rename" && promptState.targetPath) {
                const oldPath = promptState.targetPath;
                const lastSlash = oldPath.lastIndexOf("/");
                const parentDir = lastSlash >= 0 ? oldPath.slice(0, lastSlash + 1) : "";
                const newPath = val.includes("/") ? val : `${parentDir}${val}`;
                if (newPath !== oldPath) {
                  await window.oro.movePath(oldPath, newPath);
                  onReindex();
                }
              } else if (promptState.type === "file") {
                const baseDir = promptState.targetDir ? `${promptState.targetDir}/` : "";
                let filePath = val.startsWith(baseDir) ? val : `${baseDir}${val}`;
                if (!filePath.includes(".")) filePath += ".md";
                const content = filePath.endsWith(".md")
                  ? `# ${filePath.split("/").pop()?.replace(/\.md$/, "") || "Untitled"}\n\n`
                  : "";
                await window.oro.writeFile(filePath, content);
                if (promptState.targetDir) {
                  setExpanded((prev) => new Set([...prev, promptState.targetDir!]));
                }
                onReindex();
                onOpenFile(filePath);
              } else if (promptState.type === "folder") {
                const baseDir = promptState.targetDir ? `${promptState.targetDir}/` : "";
                const dirPath = val.startsWith(baseDir) ? val : `${baseDir}${val}`;
                await window.oro.createFolder(dirPath);
                setExpanded((prev) => new Set([...prev, dirPath, ...(promptState.targetDir ? [promptState.targetDir] : [])]));
                onReindex();
              }
            } catch (err) {
              console.error("Sidebar action error:", err);
            }
            setPromptState(null);
          }}
        />
      )}
    </div>
  );
};
