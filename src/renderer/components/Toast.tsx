import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  durationMs?: number;
}

type Listener = (items: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snap = [...toasts];
  for (const fn of listeners) fn(snap);
}

export function showToast(
  message: string,
  kind: ToastKind = "info",
  durationMs = 2600
) {
  const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  toasts = [...toasts.slice(-3), { id, kind, message, durationMs }];
  emit();
  if (durationMs > 0) {
    window.setTimeout(() => dismissToast(id), durationMs);
  }
}

export function dismissToast(id: string) {
  const next = toasts.filter((t) => t.id !== id);
  if (next.length !== toasts.length) {
    toasts = next;
    emit();
  }
}

export const ToastHost: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>(toasts);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast-card toast-${t.kind}`}>
          <span className="toast-icon">
            {t.kind === "success" ? (
              <CheckCircle2 size={14} />
            ) : t.kind === "error" ? (
              <AlertCircle size={14} />
            ) : (
              <Info size={14} />
            )}
          </span>
          <span className="toast-message">{t.message}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
};
