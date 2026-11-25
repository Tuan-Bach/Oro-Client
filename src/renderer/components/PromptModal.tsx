import React, { useEffect, useState } from "react";
import { FilePlus, FolderPlus, Edit3, X } from "lucide-react";

interface PromptModalProps {
  type: "file" | "folder" | "rename";
  initialValue?: string;
  title?: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  type,
  initialValue = "",
  title,
  onClose,
  onSubmit,
}) => {
  const [val, setVal] = useState(initialValue);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = val.trim();
    if (clean) {
      onSubmit(clean);
      onClose();
    }
  };

  const modalTitle =
    title ||
    (type === "file"
      ? "Create New File"
      : type === "folder"
      ? "Create New Folder"
      : "Rename");

  const icon =
    type === "file" ? (
      <FilePlus size={16} />
    ) : type === "folder" ? (
      <FolderPlus size={16} />
    ) : (
      <Edit3 size={16} />
    );

  const submitLabel = type === "rename" ? "Rename" : "Create";

  return (
    <div className="modal-overlay no-drag" onClick={onClose}>
      <div
        className="modal-content no-drag"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7, color: "var(--accent)" }}>
            {icon}
            {modalTitle}
          </div>
          <button className="btn no-drag" onClick={onClose} style={{ padding: 4 }}>
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            {type === "rename"
              ? "Enter new name or path:"
              : type === "file"
              ? "Enter note title (e.g. Daily Standup or Notes/Meeting):"
              : "Enter folder name (e.g. Research or Projects/App):"}
          </div>
          <input
            autoFocus
            type="text"
            className="no-drag"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={type === "file" ? "My Note" : type === "folder" ? "NewFolder" : "NewName"}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              background: "var(--bg-canvas)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontSize: 13,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="btn no-drag" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary no-drag" disabled={!val.trim() || val.trim() === initialValue}>
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
