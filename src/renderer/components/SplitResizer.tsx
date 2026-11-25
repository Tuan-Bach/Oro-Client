import React, { useCallback, useRef, useState } from "react";

interface SplitResizerProps {
  onDrag: (deltaX: number) => void;
  direction?: "horizontal" | "vertical";
  className?: string;
  style?: React.CSSProperties;
  onDoubleClick?: () => void;
}

export const SplitResizer: React.FC<SplitResizerProps> = ({
  onDrag,
  direction = "horizontal",
  className = "",
  style = {},
  onDoubleClick,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startPosRef = useRef<number>(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      startPosRef.current = direction === "horizontal" ? e.clientX : e.clientY;

      const onPointerMove = (moveEvt: PointerEvent) => {
        const currentPos = direction === "horizontal" ? moveEvt.clientX : moveEvt.clientY;
        const delta = currentPos - startPosRef.current;
        startPosRef.current = currentPos;
        onDrag(delta);
      };

      const onPointerUp = () => {
        setIsDragging(false);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [direction, onDrag]
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`split-resizer ${direction} ${isDragging ? "dragging" : ""} ${className}`}
      style={{
        width: direction === "horizontal" ? 1 : "100%",
        height: direction === "horizontal" ? "100%" : 1,
        background: isDragging
          ? "var(--text-muted)"
          : isHovered
          ? "var(--border-focus)"
          : "transparent",
        opacity: isDragging ? 1 : isHovered ? 0.9 : 1,
        boxShadow: "none",
        cursor: direction === "horizontal" ? "col-resize" : "row-resize",
        userSelect: "none",
        flexShrink: 0,
        zIndex: 25,
        position: "relative",
        transition: isDragging ? "none" : "background 0.15s ease",
        ...style,
      }}
    >
      {/* Invisible wider grab handle extending 3px on each side for frictionless grabbing */}
      <div
        style={{
          position: "absolute",
          top: direction === "horizontal" ? 0 : -3,
          bottom: direction === "horizontal" ? 0 : -3,
          left: direction === "horizontal" ? -3 : 0,
          right: direction === "horizontal" ? -3 : 0,
          cursor: direction === "horizontal" ? "col-resize" : "row-resize",
        }}
      />
    </div>
  );
};
