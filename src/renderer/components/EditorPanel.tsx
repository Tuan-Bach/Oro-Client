import React, { useEffect, useMemo, useRef, useState } from "react";
import MonacoEditor, { DiffEditor as MonacoDiffEditor } from "@monaco-editor/react";
import {
  FileText,
  FileCode,
  Save,
  ExternalLink,
  X,
  Columns,
  Eye,
  Code,
  GitCompare,
  Link,
  FilePlus,
  Bold,
  Italic,
  List,
  Quote,
  Copy,
  FolderSearch,
  Scissors,
  ClipboardPaste,
  TextSelect,
  AlignLeft,
  Terminal,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { marked } from "marked";
import type { BacklinkInfo, NoteLinkRecord, EditorPreferences, TreeNode } from "../../types.js";
import { SplitResizer } from "./SplitResizer.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { processDroppedFiles } from "../utils/fileDropHelper.js";

// React 19 JSX compatibility cast
const Editor = MonacoEditor as unknown as React.ComponentType<any>;
const DiffEditor = MonacoDiffEditor as unknown as React.ComponentType<any>;

export interface OpenTab {
  path: string;
  title: string;
  content: string;
  originalContent?: string;
  isDirty?: boolean;
  isPreview?: boolean;
}

export type EditorViewMode = "editor" | "split" | "preview" | "diff";

interface EditorPanelProps {
  tabs: OpenTab[];
  activePath: string | null;
  tree?: TreeNode[];
  viewMode?: EditorViewMode;
  onChangeViewMode?: (mode: EditorViewMode) => void;
  onSelectTab: (path: string) => void;
  onPinTab?: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCloseOtherTabs?: (path: string) => void;
  onCloseTabsToRight?: (path: string) => void;
  onUpdateContent: (path: string, newContent: string) => void;
  onSaveFile: (path: string) => void;
  onOpenExternal: (path: string) => void;
  onFollowWikiLink: (target: string) => void;
  editorConfig?: EditorPreferences;
  onClosePanel?: () => void;
  dockMode?: "floating" | "split";
  onToggleDockMode?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

function extractNotes(nodes: TreeNode[]): Array<{ path: string; name: string }> {
  const list: Array<{ path: string; name: string }> = [];
  for (const n of nodes) {
    if (!n.isDir) list.push({ path: n.path, name: n.name });
    if (n.children) list.push(...extractNotes(n.children));
  }
  return list;
}

function getLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
    case "markdown":
      return "markdown";
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "json":
      return "json";
    case "css":
      return "css";
    case "html":
      return "html";
    case "py":
      return "python";
    case "sh":
    case "bash":
      return "shell";
    default:
      return "plaintext";
  }
}

export const FONT_PRESETS: Record<string, { label: string; family: string }> = {
  sans: {
    label: "Sans (Prose)",
    family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  mono: {
    label: "Mono (Code)",
    family: '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
  },
  serif: {
    label: "Serif (Story)",
    family: 'Georgia, Cambria, "Times New Roman", Times, serif',
  },
};

function defineOroMonacoTheme(monaco: any) {
  if (!monaco || monaco._oroThemeDefined === 7) return;
  monaco._oroThemeDefined = 7;
  monaco.editor.defineTheme("oro-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "c4c4c8" },
      { token: "string", foreground: "d4a373" },
      { token: "string.link", foreground: "38bdf8", fontStyle: "underline" },
      { token: "keyword", foreground: "c4c4c8" },
      { token: "keyword.md", foreground: "60a5fa", fontStyle: "bold" },
      { token: "header", foreground: "60a5fa", fontStyle: "bold" },
      { token: "heading", foreground: "60a5fa", fontStyle: "bold" },
      { token: "comment", foreground: "5e5e68", fontStyle: "italic" },
      { token: "comment.md", foreground: "94a3b8", fontStyle: "italic" },
      { token: "tag", foreground: "c084fc" },
      { token: "tag.md", foreground: "c084fc" },
      { token: "strong", foreground: "ffffff", fontStyle: "bold" },
      { token: "emphasis", foreground: "cbd5e1", fontStyle: "italic" },
      { token: "type", foreground: "a8b5cc" },
      { token: "variable", foreground: "c4c4c8" },
      { token: "variable.md", foreground: "93c5fd" },
      { token: "number", foreground: "d4a373" },
      { token: "delimiter", foreground: "7a7a85" },
      { token: "meta.separator", foreground: "475569" },
    ],
    colors: {
      "editor.background": "#121215",
      "editor.foreground": "#f4f4f5",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "rgba(255, 255, 255, 0.16)",
      "editor.inactiveSelectionBackground": "rgba(255, 255, 255, 0.08)",
      "editor.selectionHighlightBackground": "rgba(255, 255, 255, 0.08)",
      "editor.selectionHighlightBorder": "#00000000",
      "editor.wordHighlightBackground": "rgba(255, 255, 255, 0.08)",
      "editor.wordHighlightBorder": "#00000000",
      "editor.wordHighlightStrongBackground": "rgba(255, 255, 255, 0.14)",
      "editor.wordHighlightStrongBorder": "#00000000",
      "editor.wordHighlightTextBackground": "rgba(255, 255, 255, 0.08)",
      "editor.wordHighlightTextBorder": "#00000000",
      "editor.findMatchBackground": "rgba(255, 255, 255, 0.22)",
      "editor.findMatchHighlightBackground": "rgba(255, 255, 255, 0.12)",
      "editor.findMatchBorder": "#00000000",
      "editor.findMatchHighlightBorder": "#00000000",
      "editorCursor.foreground": "#ececec",
      "editorWhitespace.foreground": "rgba(255, 255, 255, 0.06)",
      "editorIndentGuide.background": "rgba(255, 255, 255, 0.04)",
      "editorIndentGuide.activeBackground": "rgba(255, 255, 255, 0.12)",
      "editorGutter.background": "#00000000",
      "editorGutter.modifiedBackground": "#00000000",
      "editorGutter.addedBackground": "#00000000",
      "editorGutter.deletedBackground": "#00000000",
      "editorError.foreground": "#00000000",
      "editorError.border": "#00000000",
      "editorError.background": "#00000000",
      "editorWarning.foreground": "#00000000",
      "editorWarning.border": "#00000000",
      "editorWarning.background": "#00000000",
      "editorInfo.foreground": "#00000000",
      "editorInfo.border": "#00000000",
      "editorOverviewRuler.errorForeground": "#00000000",
      "editorOverviewRuler.warningForeground": "#00000000",
      "editorOverviewRuler.infoForeground": "#00000000",
      "editorOverviewRuler.border": "#00000000",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "rgba(255, 255, 255, 0.12)",
      "scrollbarSlider.hoverBackground": "rgba(255, 255, 255, 0.22)",
      "scrollbarSlider.activeBackground": "rgba(255, 255, 255, 0.32)",
      "editorOverviewRuler.background": "#00000000",
      "editorBracketHighlight.unexpectedBracket.foreground": "#00000000",
      "editorBracketMatch.background": "#00000000",
      "editorBracketMatch.border": "#00000000",
      "editorWidget.background": "#18181c",
      "editorWidget.border": "rgba(255, 255, 255, 0.08)",
      "editorSuggestWidget.background": "#18181c",
      "editorSuggestWidget.border": "rgba(255, 255, 255, 0.08)",
      "editorSuggestWidget.foreground": "#f4f4f5",
      "editorSuggestWidget.selectedBackground": "rgba(255, 255, 255, 0.08)",
      "diffEditor.insertedTextBackground": "rgba(46, 160, 67, 0.18)",
      "diffEditor.insertedLineBackground": "rgba(46, 160, 67, 0.10)",
      "diffEditor.removedTextBackground": "rgba(248, 81, 73, 0.18)",
      "diffEditor.removedLineBackground": "rgba(248, 81, 73, 0.10)",
      "diffEditorOverview.insertedForeground": "#00000000",
      "diffEditorOverview.removedForeground": "#00000000",
      "diffEditor.diagonalFill": "#00000000",
    },
  });

  monaco.editor.defineTheme("oro-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "1e293b" },
      { token: "string", foreground: "b45309" },
      { token: "string.link", foreground: "0284c7", fontStyle: "underline" },
      { token: "keyword", foreground: "0f172a" },
      { token: "keyword.md", foreground: "0284c7", fontStyle: "bold" },
      { token: "header", foreground: "0369a1", fontStyle: "bold" },
      { token: "heading", foreground: "0369a1", fontStyle: "bold" },
      { token: "comment", foreground: "94a3b8", fontStyle: "italic" },
      { token: "comment.md", foreground: "94a3b8", fontStyle: "italic" },
      { token: "tag", foreground: "7c3aed" },
      { token: "tag.md", foreground: "7c3aed" },
      { token: "strong", foreground: "0f172a", fontStyle: "bold" },
      { token: "emphasis", foreground: "334155", fontStyle: "italic" },
      { token: "type", foreground: "0369a1" },
      { token: "variable", foreground: "0f172a" },
      { token: "variable.md", foreground: "0284c7" },
      { token: "number", foreground: "b45309" },
      { token: "delimiter", foreground: "64748b" },
      { token: "meta.separator", foreground: "cbd5e1" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#09090b",
      "editorLineNumber.foreground": "#8a8a93",
      "editorLineNumber.activeForeground": "#09090b",
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "rgba(0, 0, 0, 0.08)",
      "editor.inactiveSelectionBackground": "rgba(0, 0, 0, 0.04)",
      "editor.selectionHighlightBackground": "rgba(0, 0, 0, 0.05)",
      "editor.selectionHighlightBorder": "#00000000",
      "editor.wordHighlightBackground": "rgba(0, 0, 0, 0.05)",
      "editor.wordHighlightBorder": "#00000000",
      "editor.wordHighlightStrongBackground": "rgba(0, 0, 0, 0.08)",
      "editor.wordHighlightStrongBorder": "#00000000",
      "editor.wordHighlightTextBackground": "rgba(0, 0, 0, 0.05)",
      "editor.wordHighlightTextBorder": "#00000000",
      "editor.findMatchBackground": "rgba(0, 0, 0, 0.14)",
      "editor.findMatchHighlightBackground": "rgba(0, 0, 0, 0.07)",
      "editor.findMatchBorder": "#00000000",
      "editor.findMatchHighlightBorder": "#00000000",
      "editorCursor.foreground": "#09090b",
      "editorWhitespace.foreground": "rgba(15, 23, 42, 0.08)",
      "editorIndentGuide.background": "rgba(15, 23, 42, 0.06)",
      "editorIndentGuide.activeBackground": "rgba(0, 0, 0, 0.15)",
      "editorGutter.background": "#00000000",
      "editorGutter.modifiedBackground": "#00000000",
      "editorGutter.addedBackground": "#00000000",
      "editorGutter.deletedBackground": "#00000000",
      "editorError.foreground": "#00000000",
      "editorError.border": "#00000000",
      "editorError.background": "#00000000",
      "editorWarning.foreground": "#00000000",
      "editorWarning.border": "#00000000",
      "editorWarning.background": "#00000000",
      "editorInfo.foreground": "#00000000",
      "editorInfo.border": "#00000000",
      "editorOverviewRuler.errorForeground": "#00000000",
      "editorOverviewRuler.warningForeground": "#00000000",
      "editorOverviewRuler.infoForeground": "#00000000",
      "editorOverviewRuler.border": "#00000000",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "rgba(15, 23, 42, 0.14)",
      "scrollbarSlider.hoverBackground": "rgba(15, 23, 42, 0.24)",
      "scrollbarSlider.activeBackground": "rgba(0, 0, 0, 0.30)",
      "editorOverviewRuler.background": "#00000000",
      "editorBracketHighlight.unexpectedBracket.foreground": "#00000000",
      "editorBracketMatch.background": "#00000000",
      "editorBracketMatch.border": "#00000000",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "rgba(0, 0, 0, 0.08)",
      "editorSuggestWidget.background": "#ffffff",
      "editorSuggestWidget.border": "rgba(0, 0, 0, 0.08)",
      "editorSuggestWidget.foreground": "#09090b",
      "editorSuggestWidget.selectedBackground": "rgba(0, 0, 0, 0.06)",
      "diffEditor.insertedTextBackground": "rgba(46, 160, 67, 0.20)",
      "diffEditor.insertedLineBackground": "rgba(46, 160, 67, 0.12)",
      "diffEditor.removedTextBackground": "rgba(248, 81, 73, 0.20)",
      "diffEditor.removedLineBackground": "rgba(248, 81, 73, 0.12)",
      "diffEditorOverview.insertedForeground": "#00000000",
      "diffEditorOverview.removedForeground": "#00000000",
      "diffEditor.diagonalFill": "#00000000",
    },
  });

  monaco.editor.defineTheme("oro-monokai", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "d6d6ce" },
      { token: "string", foreground: "e6db74" },
      { token: "string.link", foreground: "66d9ef", fontStyle: "underline" },
      { token: "keyword", foreground: "f92672" },
      { token: "keyword.md", foreground: "f92672", fontStyle: "bold" },
      { token: "header", foreground: "a6e22e", fontStyle: "bold" },
      { token: "heading", foreground: "a6e22e", fontStyle: "bold" },
      { token: "comment", foreground: "75715e", fontStyle: "italic" },
      { token: "comment.md", foreground: "75715e", fontStyle: "italic" },
      { token: "tag", foreground: "f92672" },
      { token: "tag.md", foreground: "f92672" },
      { token: "strong", foreground: "eaeae0", fontStyle: "bold" },
      { token: "emphasis", foreground: "fd971f", fontStyle: "italic" },
      { token: "type", foreground: "66d9ef", fontStyle: "italic" },
      { token: "variable", foreground: "d6d6ce" },
      { token: "variable.md", foreground: "fd971f" },
      { token: "number", foreground: "ae81ff" },
      { token: "delimiter", foreground: "8f908a" },
    ],
    colors: {
      "editor.background": "#272822",
      "editor.foreground": "#d6d6ce",
      "editor.lineHighlightBackground": "#3e3d3288",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#49483e",
      "editor.inactiveSelectionBackground": "rgba(255, 255, 255, 0.06)",
      "editor.selectionHighlightBackground": "rgba(255, 255, 255, 0.08)",
      "editor.selectionHighlightBorder": "#00000000",
      "editor.wordHighlightBackground": "rgba(255, 255, 255, 0.08)",
      "editor.wordHighlightBorder": "#00000000",
      "editor.wordHighlightStrongBackground": "rgba(255, 255, 255, 0.14)",
      "editor.wordHighlightStrongBorder": "#00000000",
      "editor.wordHighlightTextBackground": "rgba(255, 255, 255, 0.08)",
      "editor.wordHighlightTextBorder": "#00000000",
      "editor.findMatchBackground": "#75715e88",
      "editor.findMatchHighlightBackground": "#75715e55",
      "editor.findMatchBorder": "#00000000",
      "editor.findMatchHighlightBorder": "#00000000",
      "editorLineNumber.foreground": "#75715e",
      "editorLineNumber.activeForeground": "#c2bead",
      "editorCursor.foreground": "#d6d6ce",
      "editorWhitespace.foreground": "rgba(255, 255, 255, 0.06)",
      "editorIndentGuide.background": "rgba(255, 255, 255, 0.05)",
      "editorIndentGuide.activeBackground": "rgba(166, 226, 46, 0.20)",
      "editorGutter.background": "#00000000",
      "scrollbarSlider.background": "rgba(255, 255, 255, 0.12)",
      "scrollbarSlider.hoverBackground": "rgba(255, 255, 255, 0.22)",
      "scrollbarSlider.activeBackground": "rgba(166, 226, 46, 0.35)",
      "editorOverviewRuler.background": "#00000000",
      "editorBracketHighlight.unexpectedBracket.foreground": "#00000000",
      "editorBracketMatch.background": "#00000000",
      "editorBracketMatch.border": "#00000000",
      "editorWidget.background": "#1e1f1c",
      "editorWidget.border": "rgba(255, 255, 255, 0.08)",
      "editorSuggestWidget.background": "#1e1f1c",
      "editorSuggestWidget.border": "rgba(255, 255, 255, 0.08)",
      "editorSuggestWidget.foreground": "#d6d6ce",
      "editorSuggestWidget.selectedBackground": "rgba(166, 226, 46, 0.20)",
    },
  });
}

export const EditorPanel: React.FC<EditorPanelProps> = ({
  tabs,
  activePath,
  tree,
  onSelectTab,
  onPinTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onUpdateContent,
  onSaveFile,
  onOpenExternal,
  onFollowWikiLink,
  editorConfig,
  onClosePanel,
  dockMode = "floating",
  onToggleDockMode,
  isExpanded,
  onToggleExpand,
  viewMode: propsViewMode,
  onChangeViewMode,
}) => {
  const activeTab = tabs.find((t) => t.path === activePath);
  const allNotesRef = useRef<Array<{ path: string; name: string }>>([]);
  const editorPanelRef = useRef<HTMLDivElement>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{
    x: number;
    y: number;
    tabPath: string;
  } | null>(null);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
    selectedText: string;
    source: "monaco" | "preview" | "panel";
  } | null>(null);

  const handleCloseOthers = (tabPath: string) => {
    if (onCloseOtherTabs) {
      onCloseOtherTabs(tabPath);
    } else {
      tabs.forEach((t) => {
        if (t.path !== tabPath) onCloseTab(t.path);
      });
    }
  };

  const handleCloseToRight = (tabPath: string) => {
    if (onCloseTabsToRight) {
      onCloseTabsToRight(tabPath);
    } else {
      const idx = tabs.findIndex((t) => t.path === tabPath);
      if (idx >= 0) {
        tabs.slice(idx + 1).forEach((t) => onCloseTab(t.path));
      }
    }
  };

  const [selectionHud, setSelectionHud] = useState<{
    top: number;
    left: number;
    hasSelection: boolean;
  } | null>(null);
  const [isEditorDraggingOver, setIsEditorDraggingOver] = useState(false);
  const editorDragCounterRef = useRef(0);

  // Clear dragging state on global dragend/drop to avoid stuck overlay states
  useEffect(() => {
    const handleGlobalDragEnd = () => {
      editorDragCounterRef.current = 0;
      setIsEditorDraggingOver(false);
    };
    window.addEventListener("dragend", handleGlobalDragEnd);
    window.addEventListener("drop", handleGlobalDragEnd);
    return () => {
      window.removeEventListener("dragend", handleGlobalDragEnd);
      window.removeEventListener("drop", handleGlobalDragEnd);
    };
  }, []);

  const handleEditorDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (!types.includes("Files") && !types.includes("application/oro-note")) {
      return;
    }
    editorDragCounterRef.current += 1;
    if (editorDragCounterRef.current === 1) {
      setIsEditorDraggingOver(true);
    }
  };

  const handleEditorDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
    } else if (types.includes("application/oro-note")) {
      e.dataTransfer.dropEffect = "link";
    }
  };

  const handleEditorDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    editorDragCounterRef.current -= 1;
    if (editorDragCounterRef.current <= 0) {
      editorDragCounterRef.current = 0;
      setIsEditorDraggingOver(false);
    }
  };

  const handleEditorDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    editorDragCounterRef.current = 0;
    setIsEditorDraggingOver(false);

    // If an internal note was dragged from the sidebar:
    const internalNote = e.dataTransfer.getData("application/oro-note");
    if (internalNote) {
      onSelectTab(internalNote);
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const processed = await processDroppedFiles(e.dataTransfer.files);
      if (processed.length === 0) return;

      for (const item of processed) {
        if (item.base64) {
          await window.oro.writeFile(item.name, item.base64, "base64");
        } else {
          await window.oro.writeFile(item.name, item.content, "utf8");
        }
        onSelectTab(item.name);
      }
    }
  };

  useEffect(() => {
    if (tree) {
      allNotesRef.current = extractNotes(tree);
    }
  }, [tree]);

  const [internalViewMode, setInternalViewMode] = useState<EditorViewMode>(editorConfig?.defaultView || "split");
  const viewMode = propsViewMode ?? internalViewMode;
  const setViewMode = onChangeViewMode ?? setInternalViewMode;
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("oro_editor_split_ratio");
      return saved ? Math.max(0.2, Math.min(0.8, parseFloat(saved))) : 0.5;
    } catch {
      return 0.5;
    }
  });

  const handleSplitResize = (deltaX: number) => {
    setSplitRatio((prev) => {
      const next = Math.max(0.2, Math.min(0.8, prev + deltaX / 800));
      try { localStorage.setItem("oro_editor_split_ratio", String(next)); } catch {}
      return next;
    });
  };

  const [backlinkData, setBacklinkData] = useState<{
    outgoing: NoteLinkRecord[];
    backlinks: BacklinkInfo[];
    tags: string[];
  }>({ outgoing: [], backlinks: [], tags: [] });

  const isMarkdown = Boolean(activePath && /\.(md|markdown|mdx)$/i.test(activePath));

  // Automatically switch to Reading/Preview mode when viewing a preview tab,
  // or restore preferred editing view when viewing a permanent tab.
  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.isPreview && isMarkdown) {
      setViewMode("preview");
    } else if (!activeTab.isPreview && isMarkdown && viewMode === "preview") {
      setViewMode(editorConfig?.defaultView || "split");
    }
  }, [activePath, activeTab?.isPreview]);

  const [isLightMode, setIsLightMode] = useState(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light"
  );

  // Listen for global theme changes (dark/light/monokai) to dynamically update Monaco editor theme
  useEffect(() => {
    const updateTheme = () => {
      const themeAttr = document.documentElement.getAttribute("data-theme") || "dark";
      const isLight = themeAttr === "light";
      setIsLightMode(isLight);
      if (monacoRef.current) {
        const monacoTheme = themeAttr === "light" ? "oro-light" : themeAttr === "monokai" ? "oro-monokai" : "oro-dark";
        monacoRef.current.editor.setTheme(monacoTheme);
      }
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Load backlinks & outgoing links when active tab changes
  useEffect(() => {
    if (!activePath || !isMarkdown) {
      setBacklinkData({ outgoing: [], backlinks: [], tags: [] });
      return;
    }
    let isMounted = true;
    window.oro.getBacklinks(activePath).then((data) => {
      if (isMounted) setBacklinkData(data);
    });
    return () => {
      isMounted = false;
    };
  }, [activePath, isMarkdown]);

  // Global Ctrl+S shortcut to save active file
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (activePath) onSaveFile(activePath);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePath, onSaveFile]);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // Dynamic file content font size according to system font size
  const computeSystemEditorFontSize = () => {
    try {
      const rawSys = document.documentElement.style.getPropertyValue("--system-font-size") ||
        localStorage.getItem("oro_system_font_size");
      const sysSize = rawSys ? parseFloat(rawSys) : 12;
      const validSys = isNaN(sysSize) || sysSize <= 0 ? 12 : sysSize;
      return Math.round(13 * (validSys / 12));
    } catch {
      return 13;
    }
  };

  const [fontSize, setFontSize] = useState<number>(() => computeSystemEditorFontSize());

  // Listen for editor font size updates (from SettingsModal or system font changes)
  useEffect(() => {
    const handleFontSizeEvent = (e: any) => {
      const newSize = Number(e.detail);
      if (newSize && !isNaN(newSize)) {
        setFontSize(newSize);
        if (editorRef.current) {
          editorRef.current.updateOptions({
            fontSize: newSize,
            lineHeight: Math.round(newSize * 1.6),
          });
        }
      }
    };
    window.addEventListener("oro:editor-font-size", handleFontSizeEvent);
    return () => window.removeEventListener("oro:editor-font-size", handleFontSizeEvent);
  }, []);

  const applyFormatting = (action: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!model || !selection) return;

    const selectedText = model.getValueInRange(selection);
    let replaceText = "";

    switch (action) {
      case "bold": {
        if (selectedText.startsWith("**") && selectedText.endsWith("**") && selectedText.length >= 4) {
          replaceText = selectedText.slice(2, -2);
        } else {
          replaceText = selectedText ? `**${selectedText}**` : `**bold**`;
        }
        break;
      }
      case "italic": {
        if (selectedText.startsWith("*") && selectedText.endsWith("*") && selectedText.length >= 2) {
          replaceText = selectedText.slice(1, -1);
        } else {
          replaceText = selectedText ? `*${selectedText}*` : `*italic*`;
        }
        break;
      }
      case "strike": {
        if (selectedText.startsWith("~~") && selectedText.endsWith("~~") && selectedText.length >= 4) {
          replaceText = selectedText.slice(2, -2);
        } else {
          replaceText = selectedText ? `~~${selectedText}~~` : `~~strikethrough~~`;
        }
        break;
      }
      case "code": {
        if (selectedText.startsWith("`") && selectedText.endsWith("`") && selectedText.length >= 2) {
          replaceText = selectedText.slice(1, -1);
        } else {
          replaceText = selectedText ? `\`${selectedText}\`` : `\`code\``;
        }
        break;
      }
      case "h1":
      case "h2":
      case "h3": {
        const prefix = action === "h1" ? "# " : action === "h2" ? "## " : "### ";
        const startLine = selection.startLineNumber;
        const lineContent = model.getLineContent(startLine);
        const cleanLine = lineContent.replace(/^#{1,6}\s*/, "");
        const range = monacoRef.current
          ? new monacoRef.current.Range(startLine, 1, startLine, lineContent.length + 1)
          : { startLineNumber: startLine, startColumn: 1, endLineNumber: startLine, endColumn: lineContent.length + 1 };
        editor.executeEdits("format-heading", [{
          range,
          text: `${prefix}${cleanLine}`,
        }]);
        editor.focus();
        return;
      }
      case "bullet": {
        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          const l = model.getLineContent(i);
          lines.push(l.startsWith("- ") ? l.slice(2) : `- ${l}`);
        }
        const range = monacoRef.current
          ? new monacoRef.current.Range(startLine, 1, endLine, model.getLineContent(endLine).length + 1)
          : { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineContent(endLine).length + 1 };
        editor.executeEdits("format-bullet", [{
          range,
          text: lines.join("\n"),
        }]);
        editor.focus();
        return;
      }
      case "numbered": {
        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          const l = model.getLineContent(i).replace(/^\d+\.\s*/, "");
          lines.push(`${i - startLine + 1}. ${l}`);
        }
        const range = monacoRef.current
          ? new monacoRef.current.Range(startLine, 1, endLine, model.getLineContent(endLine).length + 1)
          : { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineContent(endLine).length + 1 };
        editor.executeEdits("format-numbered", [{
          range,
          text: lines.join("\n"),
        }]);
        editor.focus();
        return;
      }
      case "task": {
        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          const l = model.getLineContent(i).replace(/^-\s*\[[ xX]\]\s*/, "");
          lines.push(`- [ ] ${l}`);
        }
        const range = monacoRef.current
          ? new monacoRef.current.Range(startLine, 1, endLine, model.getLineContent(endLine).length + 1)
          : { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineContent(endLine).length + 1 };
        editor.executeEdits("format-task", [{
          range,
          text: lines.join("\n"),
        }]);
        editor.focus();
        return;
      }
      case "quote": {
        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;
        const lines: string[] = [];
        for (let i = startLine; i <= endLine; i++) {
          const l = model.getLineContent(i);
          lines.push(l.startsWith("> ") ? l.slice(2) : `> ${l}`);
        }
        const range = monacoRef.current
          ? new monacoRef.current.Range(startLine, 1, endLine, model.getLineContent(endLine).length + 1)
          : { startLineNumber: startLine, startColumn: 1, endLineNumber: endLine, endColumn: model.getLineContent(endLine).length + 1 };
        editor.executeEdits("format-quote", [{
          range,
          text: lines.join("\n"),
        }]);
        editor.focus();
        return;
      }
      case "wiki": {
        if (selectedText.startsWith("[[") && selectedText.endsWith("]]") && selectedText.length >= 4) {
          replaceText = selectedText.slice(2, -2);
        } else {
          replaceText = selectedText ? `[[${selectedText}]]` : `[[Note Name]]`;
        }
        break;
      }
      case "codeblock": {
        replaceText = selectedText ? `\`\`\`markdown\n${selectedText}\n\`\`\`\n` : `\`\`\`typescript\n// code\n\`\`\`\n`;
        break;
      }
      case "hr": {
        replaceText = `\n---\n\n`;
        break;
      }
      default:
        return;
    }

    editor.executeEdits("format-inline", [{
      range: selection,
      text: replaceText,
      forceMoveMarkers: true,
    }]);
    editor.focus();
  };

  const handleCut = () => {
    if (editorRef.current) {
      const editor = editorRef.current;
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (sel && model) {
        const text = model.getValueInRange(sel);
        if (text) {
          navigator.clipboard.writeText(text);
          editor.executeEdits("cut", [{ range: sel, text: "", forceMoveMarkers: true }]);
          editor.focus();
        }
      }
    }
  };

  const handleCopy = (selectedText: string) => {
    if (selectedText) {
      navigator.clipboard.writeText(selectedText);
    } else if (editorRef.current) {
      const editor = editorRef.current;
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (sel && model) {
        const text = model.getValueInRange(sel);
        if (text) navigator.clipboard.writeText(text);
      }
    }
  };

  const handlePaste = async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && editorRef.current) {
        const editor = editorRef.current;
        const sel = editor.getSelection();
        if (sel) {
          editor.executeEdits("paste", [{ range: sel, text: clipText, forceMoveMarkers: true }]);
          editor.focus();
        }
      }
    } catch (err) {
      console.error("Paste error:", err);
    }
  };

  const handleSelectAll = () => {
    if (editorRef.current) {
      const editor = editorRef.current;
      const model = editor.getModel();
      if (model) {
        editor.setSelection(model.getFullModelRange());
        editor.focus();
      }
    } else if (window.getSelection) {
      const sel = window.getSelection();
      const range = document.createRange();
      if (editorPanelRef.current) {
        range.selectNodeContents(editorPanelRef.current);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  const handleFormatDocument = () => {
    if (editorRef.current) {
      editorRef.current.getAction("editor.action.formatDocument")?.run();
      editorRef.current.focus();
    }
  };

  const handleOpenCommandPalette = () => {
    if (editorRef.current) {
      editorRef.current.trigger("contextmenu", "editor.action.quickCommand", null);
    }
  };

  const getEditorContextMenuItems = (): ContextMenuItem[] => {
    if (!editorContextMenu || !activeTab) return [];
    const { hasSelection, selectedText, source } = editorContextMenu;
    const isMonaco = source === "monaco";
    const isMd = activeTab.path.toLowerCase().endsWith(".md");

    const items: ContextMenuItem[] = [];

    // Clipboard Section (Formatting is accessed via selection HUD or Ctrl+B/I/K hotkeys)
    items.push(
      {
        id: "cut",
        label: "Cut",
        shortcut: "Ctrl+X",
        icon: <Scissors size={14} />,
        disabled: !hasSelection || !isMonaco,
        onClick: handleCut,
      },
      {
        id: "copy",
        label: "Copy",
        shortcut: "Ctrl+C",
        icon: <Copy size={14} />,
        disabled: !hasSelection && !selectedText,
        onClick: () => handleCopy(selectedText),
      },
      {
        id: "paste",
        label: "Paste",
        shortcut: "Ctrl+V",
        icon: <ClipboardPaste size={14} />,
        disabled: !isMonaco,
        onClick: handlePaste,
      },
      {
        id: "select_all",
        label: "Select All",
        shortcut: "Ctrl+A",
        icon: <TextSelect size={14} />,
        onClick: handleSelectAll,
      }
    );

    // Advanced Editor Actions
    if (isMonaco) {
      items.push(
        { id: "d_actions", divider: true },
        {
          id: "format_doc",
          label: "Format Document",
          shortcut: "Shift+Alt+F",
          icon: <AlignLeft size={14} />,
          onClick: handleFormatDocument,
        },
        {
          id: "command_palette",
          label: "Command Palette",
          shortcut: "F1",
          icon: <Terminal size={14} />,
          onClick: handleOpenCommandPalette,
        }
      );
    }

    // File Actions
    items.push(
      { id: "d_file", divider: true },
      {
        id: "save",
        label: "Save File",
        shortcut: "Ctrl+S",
        icon: <Save size={14} />,
        disabled: !activeTab.isDirty,
        onClick: () => onSaveFile(activeTab.path),
      },
      {
        id: "reveal",
        label: "Reveal in File Explorer",
        icon: <FolderSearch size={14} />,
        onClick: () => window.oro?.revealInExplorer?.(activeTab.path),
      },
      {
        id: "external",
        label: "Open in External Editor",
        icon: <ExternalLink size={14} />,
        onClick: () => onOpenExternal(activeTab.path),
      }
    );

    return items;
  };

  // Transform markdown and replace [[wiki-links]] with interactive clickable links
  const renderedHtml = useMemo(() => {
    if (!activeTab || !isMarkdown) return "";
    let content = activeTab.content;

    // Mask code blocks and inline code so [[wiki-links]] inside backticks aren't replaced with HTML
    const codeMasks: string[] = [];
    content = content.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
      codeMasks.push(match);
      return `__ORO_CODE_MASK_${codeMasks.length - 1}__`;
    });

    // Convert [[target|alias]] and [[target]] to custom clickable HTML
    content = content.replace(/\[\[([^\[\]]+)\]\]/g, (_match, inner: string) => {
      const [targetAndHeading, alias] = inner.split("|");
      const [target] = (targetAndHeading ?? "").split("#");
      const label = alias?.trim() || target?.trim();
      return `<a class="wiki-link" data-wiki="${encodeURIComponent(target?.trim() || "")}">${label}</a>`;
    });

    // Restore masked code
    content = content.replace(/__ORO_CODE_MASK_(\d+)__/g, (_m, idx) => codeMasks[Number(idx)] || "");

    return marked.parse(content) as string;
  }, [activeTab, isMarkdown]);

  // Catch clicks inside rendered markdown for [[wiki-links]]
  const handleMarkdownClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest(".wiki-link");
    if (target) {
      const wikiTarget = target.getAttribute("data-wiki");
      if (wikiTarget) {
        e.preventDefault();
        onFollowWikiLink(decodeURIComponent(wikiTarget));
      }
    }
  };

  if (!activeTab) {
    return (
      <div
        className="workspace-column"
        onDragEnter={handleEditorDragEnter}
        onDragOver={handleEditorDragOver}
        onDragLeave={handleEditorDragLeave}
        onDrop={handleEditorDrop}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}
      >
        {isEditorDraggingOver && (
          <div
            style={{
              position: "absolute",
              inset: 6,
              borderRadius: 8,
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
            <FileCode size={24} style={{ color: "var(--cyan)" }} />
            <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>
              Drop file or multiple to open in Editor
            </div>
          </div>
        )}
        {onClosePanel && (
          <button
            type="button"
            className="unified-btn"
            onClick={onClosePanel}
            title="Close editor / preview section"
            style={{ position: "absolute", top: 10, right: 10, width: 22, height: 22, padding: 0 }}
          >
            <X size={12} />
          </button>
        )}
        <div style={{ textAlign: "center", color: "var(--text-muted)", maxWidth: 360, padding: 24 }}>
          <div style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: "var(--hover-overlay)",
            border: "1px solid var(--border-subtle)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}>
            <FileText size={20} style={{ color: "var(--text-muted)" }} />
          </div>
          <div style={{ fontWeight: 500, color: "var(--text)", fontSize: 13.5, marginBottom: 4 }}>No Document Open</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-muted)", marginBottom: 14 }}>
            Select a file from the sidebar, or ask Oro to research and create notes for you.
          </div>
          <button
            className="unified-btn"
            onClick={() => onFollowWikiLink("Welcome")}
            style={{ padding: "5px 12px", fontSize: 11.5, background: "var(--hover-overlay)", color: "var(--text)" }}
          >
            Open Welcome.md
          </button>
        </div>
      </div>
    );
  }

  const effectiveViewMode = !isMarkdown && viewMode === "split" ? "editor" : viewMode;

  return (
    <div
      className="workspace-column"
      ref={editorPanelRef}
      onDragEnter={handleEditorDragEnter}
      onDragOver={handleEditorDragOver}
      onDragLeave={handleEditorDragLeave}
      onDrop={handleEditorDrop}
      style={{ position: "relative" }}
    >
      {isEditorDraggingOver && (
        <div
          style={{
            position: "absolute",
            inset: 6,
            borderRadius: 8,
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
          <FileCode size={24} style={{ color: "var(--cyan)" }} />
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>
            Drop file or multiple to open in Editor
          </div>
        </div>
      )}
      {/* Floating Contextual Formatting HUD (Active on Text Selection) */}
      {selectionHud && selectionHud.hasSelection && (
        <div
          className="floating-selection-hud"
          style={{
            top: Math.max(8, selectionHud.top),
            left: selectionHud.left,
          }}
        >
          <button
            type="button"
            className="hud-btn"
            onClick={() => applyFormatting("bold")}
            title="Bold (Ctrl+B)"
          >
            <Bold size={12} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => applyFormatting("italic")}
            title="Italic (Ctrl+I)"
          >
            <Italic size={12} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => applyFormatting("code")}
            title="Inline Code (`)"
          >
            <Code size={12} strokeWidth={2.4} />
          </button>

          <div className="hud-divider" />

          <button
            type="button"
            className="hud-btn"
            onClick={() => applyFormatting("wiki")}
            title="Wiki Link [[ ]] (Ctrl+K)"
          >
            <Link size={12} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => applyFormatting("bullet")}
            title="Bullet List"
          >
            <List size={12} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => applyFormatting("quote")}
            title="Blockquote (>)"
          >
            <Quote size={12} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* Premier Tab Bar */}
      <div className="editor-tab-bar">
        {/* If single tab is open, show sleek ghost title instead of boxy tab strip */}
        {tabs.length <= 1 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 7, paddingLeft: 12, minWidth: 0, flex: 1 }}>
            {activeTab.path.toLowerCase().endsWith(".md") ? (
              <FileText size={13} style={{ color: "var(--cyan)", flexShrink: 0 }} />
            ) : (
              <FileCode size={13} style={{ color: "var(--cyan)", flexShrink: 0 }} />
            )}
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "var(--text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontStyle: activeTab.isPreview ? "italic" : "normal",
              }}
              title={activeTab.path}
            >
              {activeTab.title}
            </span>
            {activeTab.isDirty && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--cyan)",
                  flexShrink: 0,
                }}
                title="Unsaved changes (Ctrl+S)"
              />
            )}
          </div>
        ) : (
          <div className="editor-tabs-list">
            {tabs.map((tab) => {
              const isActive = tab.path === activePath;
              const isMd = tab.path.toLowerCase().endsWith(".md");
              return (
                <div
                  key={tab.path}
                  className={`editor-tab ${isActive ? "active" : ""}`}
                  onClick={() => onSelectTab(tab.path)}
                  onDoubleClick={() => onPinTab && onPinTab(tab.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTabContextMenu({
                      x: e.clientX,
                      y: e.clientY,
                      tabPath: tab.path,
                    });
                  }}
                  title={tab.isPreview ? `${tab.path} (Preview — double-click tab to keep open)` : tab.path}
                >
                  {isMd ? (
                    <FileText size={13} style={{ color: isActive ? "var(--text)" : "var(--text-subtle)", flexShrink: 0 }} />
                  ) : (
                    <FileCode size={13} style={{ color: isActive ? "var(--text)" : "var(--text-subtle)", flexShrink: 0 }} />
                  )}
                  <span
                    className="editor-tab-title"
                    style={{ fontStyle: tab.isPreview ? "italic" : "normal" }}
                  >
                    {tab.title}
                  </span>
                  {tab.isDirty && (
                    <span className="tab-dirty-indicator" title="Unsaved changes" />
                  )}
                  <span
                    className="tab-close-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTab(tab.path);
                    }}
                    title="Close (Ctrl+W)"
                  >
                    <X size={11} />
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Right side of editor tab strip: Ambient Save, Dock toggle & Close */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "0 8px", flexShrink: 0 }}>
          {activeTab.isDirty && (
            <button
              className="unified-btn"
              onClick={() => onSaveFile(activeTab.path)}
              title="Save file (Ctrl+S)"
              style={{
                fontSize: 10.5,
                height: 22,
                padding: "0 7px",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color: "var(--cyan)",
                border: "1px solid var(--border-focus)",
                background: isLightMode ? "rgba(2, 132, 199, 0.08)" : undefined,
                borderRadius: 9999,
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cyan)" }} />
              <span>Save</span>
            </button>
          )}

          {dockMode === "floating" && onToggleExpand && (
            <button
              type="button"
              className="unified-btn no-drag"
              onClick={onToggleExpand}
              title={isExpanded ? "Collapse to compact width" : "Expand width (leaves chat visible)"}
              style={{ width: 22, height: 22, padding: 0, borderRadius: 9999, color: "var(--text-muted)" }}
            >
              {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}

          {onToggleDockMode && (
            <button
              type="button"
              className="unified-btn no-drag"
              onClick={onToggleDockMode}
              title={dockMode === "split" ? "Float over chat" : "Dock side-by-side"}
              style={{ width: 22, height: 22, padding: 0, borderRadius: 9999, color: "var(--text-muted)" }}
            >
              <Columns size={12} />
            </button>
          )}

          {onClosePanel && (
            <button
              type="button"
              className="unified-btn no-drag"
              onClick={onClosePanel}
              title="Close editor (Esc / Ctrl+E)"
              style={{ width: 22, height: 22, padding: 0, borderRadius: 9999, color: "var(--text-muted)" }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Editor Main Content Area */}
      <div style={{ flex: 1, display: "flex", minWidth: 0, overflow: "hidden" }}>
        {/* Monaco Editor Pane */}
        {(effectiveViewMode === "editor" || effectiveViewMode === "split") && (
          <div
            data-minimap={editorConfig?.minimap === true ? "true" : "false"}
            style={{
              width: effectiveViewMode === "split" ? `${Math.round(splitRatio * 100)}%` : "100%",
              minWidth: effectiveViewMode === "split" ? 140 : 0,
              height: "100%",
              overflow: "hidden",
            }}
          >
            <Editor
              height="100%"
              theme={isLightMode ? "oro-light" : "oro-dark"}
              beforeMount={defineOroMonacoTheme}
              language={getLanguage(activeTab.path)}
              value={activeTab.content}
              onChange={(value: string | undefined) => onUpdateContent(activeTab.path, value ?? "")}
              onMount={(editor: any, monaco: any) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                defineOroMonacoTheme(monaco);
                const themeAttr = document.documentElement.getAttribute("data-theme") || "dark";
                const monacoTheme = themeAttr === "light" ? "oro-light" : themeAttr === "monokai" ? "oro-monokai" : "oro-dark";
                monaco.editor.setTheme(monacoTheme);

                // Keyboard shortcuts for markdown formatting
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => applyFormatting("bold"));
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => applyFormatting("italic"));
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => applyFormatting("wiki"));

                // Floating Contextual HUD on Text Selection (Minimalist Zero-Toolbar UX)
                editor.onDidChangeCursorSelection((e: any) => {
                  const sel = e.selection;
                  if (!sel || (sel.startLineNumber === sel.endLineNumber && sel.startColumn === sel.endColumn)) {
                    setSelectionHud(null);
                    return;
                  }
                  const pos = editor.getScrolledVisiblePosition({
                    lineNumber: sel.startLineNumber,
                    column: sel.startColumn,
                  });
                  if (pos && editorPanelRef.current) {
                    const parentRect = editorPanelRef.current.getBoundingClientRect();
                    const editorDom = editor.getDomNode();
                    const editorRect = editorDom ? editorDom.getBoundingClientRect() : parentRect;
                    const top = editorRect.top - parentRect.top + pos.top - 40;
                    const left = Math.max(16, Math.min(parentRect.width - 240, editorRect.left - parentRect.left + pos.left - 20));
                    setSelectionHud({ top, left, hasSelection: true });
                  }
                });

                if (!monaco._oroWikiCompletionRegistered) {
                  monaco._oroWikiCompletionRegistered = true;
                  monaco.languages.registerCompletionItemProvider("markdown", {
                    triggerCharacters: ["[", "/"],
                    provideCompletionItems: (model: any, position: any) => {
                      const lineContent = model.getLineContent(position.lineNumber);
                      const prefix = lineContent.substring(0, position.column - 1);
                      const match = prefix.match(/\[\[([^\]]*)$/);
                      if (!match) return { suggestions: [] };

                      const typed = match[1] || "";
                      const notes = allNotesRef.current || [];
                      const suggestions = notes
                        .filter((n) => n.name.toLowerCase().includes(typed.toLowerCase()))
                        .map((n) => {
                          const cleanTitle = n.name.replace(/\.md$/i, "");
                          return {
                            label: cleanTitle,
                            kind: monaco.languages.CompletionItemKind.Reference,
                            insertText: `${cleanTitle}]]`,
                            detail: n.path,
                            documentation: `Link to [[${cleanTitle}]]`,
                          };
                        });

                      return { suggestions };
                    },
                  });
                }

                // Intercept Monaco context menu to display unified Oro Context Menu
                editor.onContextMenu((e: any) => {
                  const browserEvt = e.event?.browserEvent;
                  if (browserEvt) {
                    browserEvt.preventDefault();
                    browserEvt.stopPropagation();
                    const sel = editor.getSelection();
                    const model = editor.getModel();
                    const selectedText = sel && model ? model.getValueInRange(sel) : "";
                    const hasSelection = Boolean(selectedText && selectedText.length > 0);

                    setEditorContextMenu({
                      x: browserEvt.clientX,
                      y: browserEvt.clientY,
                      hasSelection,
                      selectedText,
                      source: "monaco",
                    });
                  }
                });
              }}
              options={{
                contextmenu: false,
                fontSize: fontSize,
                lineNumbers: editorConfig?.lineNumbers ?? "on",
                lineNumbersMinChars: 3,
                lineDecorationsWidth: 18,
                minimap: { enabled: editorConfig?.minimap === true },
                wordWrap: editorConfig?.wordWrap ?? "on",
                scrollBeyondLastLine: false,
                fontFamily: "var(--system-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                lineHeight: Math.round(fontSize * 1.6),
                automaticLayout: true,
                padding: { top: 12 },
                renderLineHighlight: "none",
                renderLineHighlightOnlyWhenFocus: false,
                renderValidationDecorations: "off",
                selectionHighlight: true,
                occurrencesHighlight: "singleFile",
                overviewRulerLanes: 0,
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                bracketPairColorization: { enabled: false },
                matchBrackets: "never",
                scrollbar: {
                  vertical: "auto",
                  horizontal: "auto",
                  verticalScrollbarSize: 6,
                  horizontalScrollbarSize: 6,
                  verticalSliderSize: 6,
                  horizontalSliderSize: 6,
                  verticalHasArrows: false,
                  horizontalHasArrows: false,
                  arrowSize: 0,
                  useShadows: false,
                },
                rulers: [],
                glyphMargin: false,
                folding: false,
                cursorWidth: 1.5,
                cursorStyle: "line",
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                smoothScrolling: true,
              }}
            />
          </div>
        )}

        {/* Resizer between Monaco and Preview in Split Mode */}
        {effectiveViewMode === "split" && (
          <SplitResizer onDrag={handleSplitResize} />
        )}

        {/* Live Rendered Markdown Preview Pane */}
        {(effectiveViewMode === "preview" || effectiveViewMode === "split") && (
          <div
            className="markdown-preview"
            style={{
              flex: 1,
              minWidth: effectiveViewMode === "split" ? 140 : 0,
              height: "100%",
              background: isLightMode ? "#ffffff" : "var(--bg-surface)",
              overflowY: "auto",
              overflowX: "hidden",
              fontFamily: "var(--system-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
              fontSize: `${fontSize}px`,
              lineHeight: 1.65,
            }}
            onClick={handleMarkdownClick}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const sel = window.getSelection()?.toString() || "";
              setEditorContextMenu({
                x: e.clientX,
                y: e.clientY,
                hasSelection: Boolean(sel && sel.length > 0),
                selectedText: sel,
                source: "preview",
              });
            }}
          >
            {/* Note Tags */}
            {backlinkData.tags.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {backlinkData.tags.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: 11,
                      color: "var(--purple)",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border)",
                      padding: "2px 8px",
                      borderRadius: 12,
                    }}
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}

            {/* Markdown Body */}
            <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />

            {/* Backlinks & Connected Notes Footer */}
            {(backlinkData.backlinks.length > 0 || backlinkData.outgoing.length > 0) && (
              <div
                style={{
                  marginTop: 36,
                  paddingTop: 16,
                  borderTop: "1px solid var(--border)",
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 450, color: "var(--text-muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                  <Link size={13} />
                  Second Brain Connections
                </div>
                {backlinkData.backlinks.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: "var(--text-subtle)", marginRight: 6 }}>Linked from:</span>
                    {backlinkData.backlinks.map((b) => (
                      <span
                        key={b.sourcePath}
                        className="wiki-link"
                        style={{ marginRight: 8, cursor: "pointer" }}
                        onClick={() => onFollowWikiLink(b.sourcePath)}
                      >
                        [[{b.sourceTitle || b.sourcePath}]]
                      </span>
                    ))}
                  </div>
                )}
                {backlinkData.outgoing.length > 0 && (
                  <div>
                    <span style={{ color: "var(--text-subtle)", marginRight: 6 }}>Outbound links:</span>
                    {backlinkData.outgoing.map((o) => (
                      <span
                        key={o.targetRaw}
                        className="wiki-link"
                        style={{ marginRight: 8, cursor: "pointer", color: "var(--cyan)" }}
                        onClick={() => onFollowWikiLink(o.targetRaw)}
                      >
                        [[{o.targetRaw}]]
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Diff View Pane */}
        {effectiveViewMode === "diff" && activeTab.originalContent && (
          <div style={{ flex: 1, height: "100%" }}>
            <DiffEditor
              height="100%"
              theme={isLightMode ? "oro-light" : "oro-dark"}
              beforeMount={defineOroMonacoTheme}
              language={getLanguage(activeTab.path)}
              original={activeTab.originalContent}
              modified={activeTab.content}
              options={{
                fontSize: fontSize,
                minimap: { enabled: false },
                wordWrap: "on",
                fontFamily: "var(--system-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                automaticLayout: true,
                renderOverviewRuler: false,
                overviewRulerLanes: 0,
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                diffCodeLens: false,
                renderSideBySide: false,
                scrollbar: {
                  vertical: "auto",
                  horizontal: "auto",
                  verticalScrollbarSize: 6,
                  horizontalScrollbarSize: 6,
                },
              }}
            />
          </div>
        )}
      </div>

      {/* Floating Tab Context Menu */}
      {tabContextMenu && (
        <ContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          items={[
            {
              id: "close",
              label: "Close Tab",
              shortcut: "Ctrl+W",
              icon: <X size={12} />,
              onClick: () => onCloseTab(tabContextMenu.tabPath),
            },
            {
              id: "close_others",
              label: "Close Other Tabs",
              disabled: tabs.length <= 1,
              onClick: () => handleCloseOthers(tabContextMenu.tabPath),
            },
            {
              id: "close_to_right",
              label: "Close Tabs to Right",
              disabled: tabs.findIndex((t) => t.path === tabContextMenu.tabPath) >= tabs.length - 1,
              onClick: () => handleCloseToRight(tabContextMenu.tabPath),
            },
            { id: "d1", divider: true },
            {
              id: "copy_path",
              label: "Copy Path",
              icon: <Copy size={12} />,
              onClick: () => navigator.clipboard.writeText(tabContextMenu.tabPath),
            },
            {
              id: "reveal",
              label: "Reveal in File Explorer",
              icon: <FolderSearch size={12} />,
              onClick: () => window.oro?.revealInExplorer?.(tabContextMenu.tabPath),
            },
            {
              id: "open_external",
              label: "Open in External Editor",
              icon: <ExternalLink size={12} />,
              onClick: () => onOpenExternal(tabContextMenu.tabPath),
            },
          ]}
          onClose={() => setTabContextMenu(null)}
        />
      )}

      {/* Floating Editor Context Menu (Unified with Oro design system) */}
      {editorContextMenu && (
        <ContextMenu
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          items={getEditorContextMenuItems()}
          onClose={() => setEditorContextMenu(null)}
        />
      )}
    </div>
  );
};
