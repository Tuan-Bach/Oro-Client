import React, { useEffect, useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw, ExternalLink, Loader2, AlertCircle, Film, Image as ImageIcon } from "lucide-react";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov"]);

export function getMediaKind(relPath: string): "image" | "video" | null {
  const ext = relPath.split(".").pop()?.toLowerCase() || "";
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}

export function isBinaryMediaPath(relPath: string): boolean {
  const ext = relPath.split(".").pop()?.toLowerCase() || "";
  return (IMAGE_EXTS.has(ext) && ext !== "svg") || VIDEO_EXTS.has(ext);
}

interface MediaViewerProps {
  relPath: string;
  onOpenExternal?: (relPath: string) => void;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({ relPath, onOpenExternal }) => {
  const kind = getMediaKind(relPath);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDataUrl(null);
    setZoom(1);

    window.oro
      .readMediaDataUrl(relPath)
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [relPath]);

  return (
    <div className="media-viewer-root">
      <div className="media-viewer-toolbar">
        <div className="media-viewer-meta">
          {kind === "video" ? <Film size={13} /> : <ImageIcon size={13} />}
          <span className="media-viewer-path" title={relPath}>
            {relPath}
          </span>
        </div>
        <div className="media-viewer-controls">
          {kind === "image" && (
            <>
              <button
                type="button"
                className="unified-btn no-drag"
                onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}
                title="Zoom Out"
              >
                <ZoomOut size={13} />
              </button>
              <span className="media-zoom-pill">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                className="unified-btn no-drag"
                onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
                title="Zoom In"
              >
                <ZoomIn size={13} />
              </button>
              <button
                type="button"
                className="unified-btn no-drag"
                onClick={() => setZoom(1)}
                title="Reset Zoom"
              >
                <RotateCcw size={12} />
              </button>
            </>
          )}
          {onOpenExternal && (
            <button
              type="button"
              className="unified-btn no-drag"
              onClick={() => onOpenExternal(relPath)}
              title="Open in External App"
            >
              <ExternalLink size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="media-viewer-stage">
        {loading ? (
          <div className="media-viewer-state">
            <Loader2 size={20} className="spin" />
            <span>Loading media...</span>
          </div>
        ) : error ? (
          <div className="media-viewer-state media-viewer-error">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        ) : kind === "video" && dataUrl ? (
          <video
            src={dataUrl}
            controls
            playsInline
            className="media-viewer-video"
          />
        ) : dataUrl ? (
          <div className="media-viewer-img-wrap">
            <img
              src={dataUrl}
              alt={relPath}
              className="media-viewer-img"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "center center",
              }}
              draggable={false}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
};
