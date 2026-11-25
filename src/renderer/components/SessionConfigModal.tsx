import React, { useEffect, useState } from "react";
import { X, Copy, Check, Sliders, Trash2, Cpu, Compass, Hammer, Sparkles } from "lucide-react";
import type { AgentModeId, SessionRecord } from "../../types.js";
import { appConfirm } from "./AppDialog.js";

interface SessionConfigModalProps {
  session: SessionRecord;
  onClose: () => void;
  onSave: (sessionId: string, patch: { title: string; mode: AgentModeId }) => Promise<void>;
  onDelete?: (sessionId: string) => void;
}

const MODES: Array<{
  id: AgentModeId;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: "default",
    label: "Default Assistant",
    description: "Versatile, intelligent coworker for conversational reasoning and tool calls.",
    icon: <Sparkles size={14} />,
  },
  {
    id: "plan",
    label: "Planner",
    description: "Decomposes goals into verifiable steps before executing actions.",
    icon: <Compass size={14} />,
  },
  {
    id: "builder",
    label: "Builder",
    description: "Fast, direct code execution, file operations, and project scaffolding.",
    icon: <Hammer size={14} />,
  },
  {
    id: "triad",
    label: "Architect / Triad",
    description: "High-level system design, multi-file blueprinting, and triad coordination.",
    icon: <Cpu size={14} />,
  },
];

export const SessionConfigModal: React.FC<SessionConfigModalProps> = ({
  session,
  onClose,
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState(session.title);
  const [mode, setMode] = useState<AgentModeId>(session.mode || "default");
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleCopyId = () => {
    navigator.clipboard.writeText(session.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1500);
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || isSaving) return;

    setIsSaving(true);
    try {
      await onSave(session.id, { title: title.trim(), mode });
      onClose();
    } catch (err) {
      console.error("Failed to save session config:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = await appConfirm({
      title: "Delete Session",
      message: `Are you sure you want to delete session "${session.title}"?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) {
      onDelete?.(session.id);
      onClose();
    }
  };

  const formattedDate = session.createdAt
    ? new Date(session.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Unknown";

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          width: "90%",
          padding: 0,
          background: "var(--modal-bg)",
          borderRadius: 14,
          border: "1px solid var(--border)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.5), 0 4px 16px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "var(--hover-overlay)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text)",
              }}
            >
              <Sliders size={15} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                Configure Session
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--text-subtle)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 2,
                }}
              >
                <span>ID: {session.id.slice(0, 16)}…</span>
                <button
                  type="button"
                  onClick={handleCopyId}
                  title="Copy full session ID"
                  style={{
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    color: copiedId ? "var(--green, #34d399)" : "var(--text-subtle)",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  {copiedId ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="unified-btn"
            onClick={onClose}
            title="Close (Esc)"
            style={{ width: 26, height: 26, padding: 0, borderRadius: 6 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSave} style={{ padding: "18px 20px 20px 20px" }}>
          {/* Section 1: Title */}
          <div style={{ marginBottom: 18 }}>
            <label
              style={{
                display: "block",
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--text-muted)",
                marginBottom: 6,
                letterSpacing: "0.02em",
              }}
            >
              Session Title
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Workspace Architecture & Diagnostics"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 12px",
                fontSize: 12.5,
                background: "var(--input-bg)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--border-focus)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            />
          </div>

          {/* Section 2: Agent Mode Selection */}
          <div style={{ marginBottom: 18 }}>
            <label
              style={{
                display: "block",
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--text-muted)",
                marginBottom: 8,
                letterSpacing: "0.02em",
              }}
            >
              Agent Personality & Mode
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {MODES.map((m) => {
                const isSelected = mode === m.id;
                return (
                  <div
                    key={m.id}
                    onClick={() => setMode(m.id)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 9,
                      border: `1px solid ${isSelected ? "var(--text)" : "var(--border)"}`,
                      background: isSelected ? "var(--hover-overlay)" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      transition: "all 0.14s ease",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: isSelected ? "var(--text)" : "var(--text-muted)",
                      }}
                    >
                      <span style={{ color: isSelected ? "var(--text)" : "var(--text-subtle)" }}>
                        {m.icon}
                      </span>
                      <span>{m.label}</span>
                      {isSelected && (
                        <Check size={12} style={{ marginLeft: "auto", color: "var(--text)" }} />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-subtle)",
                        lineHeight: 1.35,
                      }}
                    >
                      {m.description}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Metadata Summary */}
          <div
            style={{
              padding: "10px 12px",
              background: "var(--card-bg, rgba(255, 255, 255, 0.02))",
              borderRadius: 8,
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 11,
              color: "var(--text-subtle)",
              marginBottom: 20,
            }}
          >
            <span>Created: {formattedDate}</span>
            <span>Provider: {session.provider || "Gemini"}</span>
          </div>

          {/* Footer Actions */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                className="unified-btn"
                style={{
                  fontSize: 11.5,
                  color: "#f87171",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 7,
                }}
              >
                <Trash2 size={13} />
                <span>Delete Session</span>
              </button>
            ) : (
              <div />
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                className="unified-btn"
                style={{ fontSize: 12, padding: "6px 12px", borderRadius: 7 }}
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={isSaving || !title.trim()}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 14px",
                  borderRadius: 7,
                  background: "var(--text)",
                  color: "var(--bg-canvas)",
                  border: "none",
                  cursor: isSaving || !title.trim() ? "not-allowed" : "pointer",
                  opacity: isSaving || !title.trim() ? 0.6 : 1,
                  transition: "opacity 0.15s ease",
                }}
              >
                {isSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
