import React, { useEffect, useState } from "react";
import { ExternalLink, Film, Image as ImageIcon } from "lucide-react";
import type { ToolCallEvent } from "../../types.js";

function extractGeneratedMediaPath(tc: ToolCallEvent): { path: string; kind: "image" | "video" } | null {
  if (tc.status !== "done") return null;
  if (tc.name !== "generate_image" && tc.name !== "generate_video") return null;
  const kind = tc.name === "generate_video" ? "video" : "image";
  const argPath = typeof tc.args?.output_path === "string" ? tc.args.output_path.trim() : "";
  if (argPath) return { path: argPath, kind };
  const summaryMatch = tc.summary?.match(/^Generated\s+(.+)$/i);
  if (summaryMatch && summaryMatch[1]) return { path: summaryMatch[1].trim(), kind };
  return null;
}

const SingleMediaCard: React.FC<{
  path: string;
  kind: "image" | "video";
  onOpenFile: (relPath: string) => void;
  onZoomImage?: (name: string, src: string) => void;
}> = ({ path, kind, onOpenFile, onZoomImage }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.oro
      .readMediaDataUrl(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (failed || !src) return null;

  return (
    <div className="inline-chat-media-card">
      {kind === "video" ? (
        <video src={src} controls playsInline className="inline-chat-media-video" />
      ) : (
        <img
          src={src}
          alt={path}
          className="inline-chat-media-img"
          onClick={() => onZoomImage?.(path.split("/").pop() || path, src)}
          title="Click to zoom"
        />
      )}
      <div className="inline-chat-media-footer">
        <span className="inline-chat-media-label">
          {kind === "video" ? <Film size={11} /> : <ImageIcon size={11} />}
          <span>{path}</span>
        </span>
        <button
          type="button"
          className="unified-btn no-drag"
          onClick={() => onOpenFile(path)}
          style={{ height: 22, padding: "0 8px", fontSize: 11, gap: 4 }}
        >
          <ExternalLink size={11} />
          <span>Open</span>
        </button>
      </div>
    </div>
  );
};

export const InlineChatMedia: React.FC<{
  toolCalls?: ToolCallEvent[];
  onOpenFile: (relPath: string) => void;
  onZoomImage?: (name: string, src: string) => void;
}> = ({ toolCalls, onOpenFile, onZoomImage }) => {
  if (!toolCalls || toolCalls.length === 0) return null;
  const mediaItems = toolCalls
    .map(extractGeneratedMediaPath)
    .filter((x): x is { path: string; kind: "image" | "video" } => x !== null);
  if (mediaItems.length === 0) return null;

  return (
    <div className="inline-chat-media-list">
      {mediaItems.map((item, idx) => (
        <SingleMediaCard
          key={`${item.path}_${idx}`}
          path={item.path}
          kind={item.kind}
          onOpenFile={onOpenFile}
          onZoomImage={onZoomImage}
        />
      ))}
    </div>
  );
};
