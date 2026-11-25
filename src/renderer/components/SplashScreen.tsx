import React, { useEffect, useState } from "react";
import { Minus, Square, X } from "lucide-react";

interface SplashScreenProps {
  isReady: boolean;
  onFinished: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ isReady, onFinished }) => {
  const [progress, setProgress] = useState(25);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setProgress(75);
    }, 200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (isReady) {
      setProgress(100);

      const exitTimer = setTimeout(() => {
        setIsExiting(true);
      }, 150);

      const unmountTimer = setTimeout(() => {
        onFinished();
      }, 390);

      return () => {
        clearTimeout(exitTimer);
        clearTimeout(unmountTimer);
      };
    }
  }, [isReady, onFinished]);

  const handleWindowControl = (action: "minimize" | "maximize" | "close") => {
    try {
      window.oro?.windowControl?.(action);
    } catch (e) {
      console.warn("Window control failed:", e);
    }
  };

  return (
    <div
      className={`splash-overlay ${isExiting ? "splash-exiting" : ""}`}
      aria-label="Loading Oro"
      role="dialog"
      aria-modal="true"
    >
      {/* Draggable TitleBar strip with window controls */}
      <div className="splash-titlebar">
        <div className="splash-drag-handle" />
        <div className="splash-controls no-drag">
          <button
            type="button"
            className="splash-win-btn"
            onClick={() => handleWindowControl("minimize")}
            title="Minimize"
          >
            <Minus size={11} />
          </button>
          <button
            type="button"
            className="splash-win-btn"
            onClick={() => handleWindowControl("maximize")}
            title="Maximize"
          >
            <Square size={10} />
          </button>
          <button
            type="button"
            className="splash-win-btn close"
            onClick={() => handleWindowControl("close")}
            title="Close"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* Main Centered Minimal Content */}
      <div className="splash-content">
        <div className="splash-brand-mark">
          <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.4" />
            <circle cx="16" cy="16" r="4.5" fill="currentColor" />
          </svg>
          <span className="splash-brand-text">Oro</span>
        </div>

        <div className="splash-track">
          <div
            className="splash-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="splash-status-text">
          {progress >= 100 ? "Ready" : "Loading workspace…"}
        </div>
      </div>
    </div>
  );
};
