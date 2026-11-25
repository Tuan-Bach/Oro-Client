import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  badge?: string | number;
  chevron?: boolean;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
  header?: string;
  onClick?: () => void;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number }>({ x, y });

  // Adjust coordinates to avoid clipping off screen edges
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let nextX = x;
    let nextY = y;

    if (nextX + rect.width > winW - 8) {
      nextX = Math.max(8, winW - rect.width - 8);
    }
    if (nextY + rect.height > winH - 8) {
      nextY = Math.max(8, winH - rect.height - 8);
    }

    setCoords({ x: nextX, y: nextY });
  }, [x, y]);

  // Click outside & Escape dismiss
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener("mousedown", handlePointerDown, true);
    window.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown, true);
      window.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="oro-context-menu"
      style={{
        position: "fixed",
        left: coords.x,
        top: coords.y,
        zIndex: 9999,
        minWidth: 195,
        maxWidth: 280,
        background: "var(--modal-bg)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: "0 16px 40px rgba(0, 0, 0, 0.45), 0 2px 10px rgba(0, 0, 0, 0.2)",
        padding: 6,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        userSelect: "none",
        animation: "contextMenuFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, idx) => {
        if (item.header) {
          return (
            <div
              key={`header-${idx}`}
              className="context-menu-header"
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-muted)",
                padding: "6px 10px 4px 10px",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              {item.header}
            </div>
          );
        }

        if (item.divider) {
          return (
            <div
              key={`divider-${idx}`}
              className="context-menu-divider"
              style={{
                height: 1,
                background: "var(--border-subtle)",
                margin: "4px 6px",
              }}
            />
          );
        }

        const isDanger = item.danger;
        const isDisabled = item.disabled;

        return (
          <button
            key={item.id}
            type="button"
            disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return;
              onClose();
              item.onClick?.();
            }}
            className={`context-menu-item unified-btn ${isDanger ? "danger" : ""}`}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "7px 10px",
              minHeight: 32,
              fontSize: 13,
              fontWeight: 450,
              borderRadius: 8,
              background: "transparent",
              color: isDisabled
                ? "var(--text-subtle)"
                : isDanger
                ? "#f87171"
                : "var(--text)",
              opacity: isDisabled ? 0.45 : 1,
              cursor: isDisabled ? "not-allowed" : "pointer",
              transition: "background 0.12s ease, color 0.12s ease",
              textAlign: "left",
              border: "none",
              outline: "none",
            }}
            onMouseEnter={(e) => {
              if (isDisabled) return;
              if (isDanger) {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
                e.currentTarget.style.color = "#fca5a5";
              } else {
                e.currentTarget.style.background = "var(--hover-overlay)";
              }
            }}
            onMouseLeave={(e) => {
              if (isDisabled) return;
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = isDanger ? "#f87171" : "var(--text)";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, overflow: "hidden" }}>
              {item.icon && (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    width: 16,
                    height: 16,
                    opacity: isDanger ? 0.9 : 0.8,
                    color: isDanger ? "#f87171" : "inherit",
                  }}
                >
                  {item.icon}
                </span>
              )}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  letterSpacing: "-0.01em",
                }}
              >
                {item.label}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, marginLeft: 14 }}>
              {item.badge !== undefined && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: "1px 7px",
                    borderRadius: 9999,
                    background: "var(--active-overlay)",
                    color: "var(--text-muted)",
                    lineHeight: "16px",
                  }}
                >
                  {item.badge}
                </span>
              )}

              {item.shortcut && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    fontFamily: "var(--system-font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
                    opacity: 0.75,
                    letterSpacing: "0.2px",
                  }}
                >
                  {item.shortcut}
                </span>
              )}

              {item.chevron && (
                <ChevronRight size={14} style={{ color: "var(--text-muted)", opacity: 0.7 }} />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};
