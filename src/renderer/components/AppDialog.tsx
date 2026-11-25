import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Edit3, Info, X } from "lucide-react";

type DialogRequest =
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      destructive?: boolean;
      resolve: (ok: boolean) => void;
    }
  | {
      kind: "prompt";
      title: string;
      message?: string;
      defaultValue?: string;
      placeholder?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      resolve: (value: string | null) => void;
    }
  | {
      kind: "alert";
      title: string;
      message: string;
      confirmLabel?: string;
      resolve: () => void;
    };

type Listener = (req: DialogRequest | null) => void;

let activeListener: Listener | null = null;
const queue: DialogRequest[] = [];
let currentReq: DialogRequest | null = null;

function dispatchNext() {
  if (currentReq || queue.length === 0) return;
  currentReq = queue.shift() ?? null;
  activeListener?.(currentReq);
}

function enqueue(req: DialogRequest) {
  queue.push(req);
  dispatchNext();
}

export function appConfirm(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({ kind: "confirm", ...opts, resolve });
  });
}

export function appPrompt(opts: {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({ kind: "prompt", ...opts, resolve });
  });
}

export function appAlert(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
}): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ kind: "alert", ...opts, resolve });
  });
}

export const AppDialogHost: React.FC = () => {
  const [req, setReq] = useState<DialogRequest | null>(currentReq);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeListener = (next) => {
      setReq(next);
      if (next?.kind === "prompt") {
        setInputVal(next.defaultValue ?? "");
      }
    };
    dispatchNext();
    return () => {
      activeListener = null;
    };
  }, []);

  useEffect(() => {
    if (!req) return;
    const t = window.setTimeout(() => {
      if (req.kind === "prompt") {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        confirmBtnRef.current?.focus();
      }
    }, 20);
    return () => window.clearTimeout(t);
  }, [req]);

  const closeCurrent = (finish: () => void) => {
    finish();
    currentReq = null;
    setReq(null);
    activeListener?.(null);
    dispatchNext();
  };

  useEffect(() => {
    if (!req) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (req.kind === "confirm") closeCurrent(() => req.resolve(false));
        else if (req.kind === "prompt") closeCurrent(() => req.resolve(null));
        else closeCurrent(() => req.resolve());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [req]);

  if (!req) return null;

  const isDestructive = req.kind === "confirm" && req.destructive;

  const handleConfirm = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (req.kind === "confirm") {
      closeCurrent(() => req.resolve(true));
    } else if (req.kind === "prompt") {
      closeCurrent(() => req.resolve(inputVal));
    } else {
      closeCurrent(() => req.resolve());
    }
  };

  const handleCancel = () => {
    if (req.kind === "confirm") {
      closeCurrent(() => req.resolve(false));
    } else if (req.kind === "prompt") {
      closeCurrent(() => req.resolve(null));
    } else {
      closeCurrent(() => req.resolve());
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        zIndex: 10050,
        backdropFilter: "blur(4px)",
        animation: "fadeIn 140ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onClick={handleCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
    >
      <form
        onSubmit={handleConfirm}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, calc(100vw - 32px))",
          background: "var(--bg-elevated, #18181b)",
          border: "1px solid var(--border, #27272a)",
          borderRadius: 12,
          padding: 20,
          boxShadow:
            "0 2px 6px rgba(0,0,0,0.16), 0 16px 40px rgba(0,0,0,0.42)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          color: "var(--text-primary, #f4f4f5)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {req.kind === "prompt" ? (
              <Edit3 size={16} style={{ color: "var(--accent, #60a5fa)" }} />
            ) : isDestructive ? (
              <AlertTriangle size={16} style={{ color: "#ef4444" }} />
            ) : (
              <Info size={16} style={{ color: "var(--accent, #60a5fa)" }} />
            )}
            <h3
              id="app-dialog-title"
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              {req.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close dialog"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted, #a1a1aa)",
              cursor: "pointer",
              padding: 4,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </div>

        {req.message && (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--text-secondary, #d4d4d8)",
              wordBreak: "break-word",
            }}
          >
            {req.message}
          </p>
        )}

        {req.kind === "prompt" && (
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder={req.placeholder}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "9px 12px",
              borderRadius: 8,
              border: "1px solid var(--border, #3f3f46)",
              background: "var(--bg-primary, #09090b)",
              color: "var(--text-primary, #f4f4f5)",
              fontSize: 13,
              outline: "none",
            }}
          />
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 4,
          }}
        >
          {req.kind !== "alert" && (
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: "1px solid var(--border, #3f3f46)",
                background: "transparent",
                color: "var(--text-secondary, #d4d4d8)",
                fontSize: 12.5,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {req.cancelLabel ?? "Cancel"}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="submit"
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "none",
              background: isDestructive
                ? "#dc2626"
                : "var(--accent, #3b82f6)",
              color: "#ffffff",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {req.confirmLabel ??
              (req.kind === "alert"
                ? "OK"
                : req.kind === "prompt"
                  ? "Save"
                  : isDestructive
                    ? "Delete"
                    : "Confirm")}
          </button>
        </div>
      </form>
    </div>
  );
};
