import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  X,
  Check,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  Sparkles,
  Type,
  Palette,
  Sun,
  Moon,
  Sliders,
  ShieldCheck,
} from "lucide-react";
import type { OroConfig, ProviderId } from "../../types.js";
import type { WorkspaceSummary } from "../../ipc-types.js";

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  defaultModel: string;
  hint: string;
}> = [
  {
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-3.8-flash",
    hint: "GEMINI_API_KEY",
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    hint: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    defaultModel: "claude-3-7-sonnet-latest",
    hint: "ANTHROPIC_API_KEY",
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    defaultModel: "llama3.2",
    hint: "http://localhost:11434",
  },
];

export const FONT_OPTIONS = [
  { id: "google-sans", label: "Google Sans", font: "'Google Sans', sans-serif" },
  { id: "inter", label: "Inter", font: "'Inter', sans-serif" },
];

export function getFontStack(fontId: string): string {
  switch (fontId) {
    case "google-sans":
    case "product-sans":
      return "'Google Sans', 'Product Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    case "inter":
    default:
      return "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }
}

export type SettingsTabId = "ai" | "appearance" | "vault";

const TABS = [
  { id: "ai", label: "AI & Models", icon: Sparkles },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "vault", label: "Workspace Vault", icon: Folder },
] as const;

export interface SettingsModalProps {
  config: OroConfig;
  workspace: WorkspaceSummary | null;
  initialTab?: "ai" | "appearance" | "vault" | "limits";
  onClose: () => void;
  onConfigUpdated: (newConfig: OroConfig) => void;
  onSwitchWorkspace: (folderPath: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  config,
  workspace,
  initialTab = "ai",
  onClose,
  onConfigUpdated,
  onSwitchWorkspace,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => {
    if (initialTab === "appearance") return "appearance";
    if (initialTab === "vault") return "vault";
    return "ai";
  });

  const [activeProvider, setActiveProvider] = useState<ProviderId>(config.provider);
  const [apiKey, setApiKey] = useState<string>("");
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>(config.providers[config.provider]?.baseUrl || "");
  const [userInstructions, setUserInstructions] = useState<string>(config.userInstructions || "");
  const [safetyLevel, setSafetyLevel] = useState<"autonomous" | "confirm_destructive" | "strict">(
    config.safetyLevel || "autonomous"
  );

  // Auto-save status: "idle" | "saving" | "saved" | "error"
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saveTimeoutRef = useRef<any>(null);
  const debounceTimerRef = useRef<any>(null);

  // Appearance & System settings
  const [theme, setTheme] = useState<"dark" | "light" | "monokai">(() => {
    try {
      return (localStorage.getItem("oro_theme") as "dark" | "light" | "monokai") || config.ui?.theme || "dark";
    } catch {
      return "dark";
    }
  });

  const ALLOWED_SCALES = [80, 90, 100, 110, 120, 130] as const;

  const [systemScale, setSystemScale] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem("oro_system_scale")) || config.ui?.systemScale || 100;
      return ALLOWED_SCALES.includes(stored as any) ? stored : 100;
    } catch {
      return 100;
    }
  });

  const [systemFont, setSystemFont] = useState<string>(() => {
    try {
      return localStorage.getItem("oro_system_font") || config.ui?.systemFont || "inter";
    } catch {
      return "inter";
    }
  });

  const applyLiveAppearance = (
    newTheme: "dark" | "light" | "monokai",
    newScale: number,
    newFont: string
  ) => {
    document.documentElement.setAttribute("data-theme", newTheme);

    // Compute native zoom factor: 100% scale = 1.20 native zoom
    const factor = (newScale / 100) * 1.20;
    if (window.oro?.setZoomFactor) {
      window.oro.setZoomFactor(factor);
    } else if (window.oroNative?.setZoomFactor) {
      window.oroNative.setZoomFactor(factor);
    }

    document.documentElement.style.setProperty("--system-font-size", "13px");
    document.documentElement.style.fontSize = "13px";
    document.body.style.fontSize = "13px";

    const fontStack = getFontStack(newFont);
    document.documentElement.style.setProperty("--system-font", fontStack);
    document.body.style.fontFamily = fontStack;
  };

  const providerSpec = PROVIDERS.find((p) => p.id === activeProvider) || PROVIDERS[0]!;
  const currentSavedKey = config.providers[activeProvider]?.apiKey;

  const [selectedModel, setSelectedModel] = useState<string>(
    config.providers[config.provider]?.model || providerSpec.defaultModel
  );
  const [reasoningEffort, setReasoningEffort] = useState<"low" | "medium" | "high">(
    () => config.providers[config.provider]?.reasoningEffort || "medium"
  );
  const [dynamicModels, setDynamicModels] = useState<Array<{ id: string; name: string; tag?: string }>>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Auto-fetch provider models whenever provider, key, or baseUrl changes
  useEffect(() => {
    let cancelled = false;
    const effectiveKey = apiKey.trim() || currentSavedKey || "";
    if (activeProvider !== "ollama" && !effectiveKey) {
      setDynamicModels([]);
      return;
    }
    setIsLoadingModels(true);
    window.oro
      .fetchProviderModels(activeProvider, effectiveKey, baseUrl.trim() || undefined)
      .then((models) => {
        if (!cancelled && models && models.length > 0) {
          setDynamicModels(models);
          if (!selectedModel || selectedModel.startsWith("gemini-1.") || selectedModel.startsWith("gemini-2.")) {
            const nextModel = models[0]!.id;
            setSelectedModel(nextModel);
            performSave({ model: nextModel });
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProvider, apiKey, baseUrl, currentSavedKey]);

  // Master auto-save implementation
  const performSave = useCallback(
    async (overrides?: {
      provider?: ProviderId;
      model?: string;
      reasoningEffort?: "low" | "medium" | "high";
      baseUrl?: string;
      apiKey?: string;
      userInstructions?: string;
      theme?: "dark" | "light" | "monokai";
      systemScale?: number;
      systemFont?: string;
      systemFontSize?: number;
      editorFontPreset?: string;
      editorFontSize?: number;
      wordWrap?: "on" | "off";
      minimap?: boolean;
      safetyLevel?: "autonomous" | "confirm_destructive" | "strict";
    }) => {
      setSaveStatus("saving");
      try {
        const p = overrides?.provider ?? activeProvider;
        const m = overrides?.model ?? selectedModel;
        const eff = overrides?.reasoningEffort ?? reasoningEffort;
        const bUrl = overrides?.baseUrl !== undefined ? overrides.baseUrl : baseUrl;
        const key = overrides?.apiKey !== undefined ? overrides.apiKey : apiKey;
        const inst = overrides?.userInstructions !== undefined ? overrides.userInstructions : userInstructions;
        const th = (overrides?.theme as "dark" | "light" | "monokai") ?? theme;
        const sc = overrides?.systemScale ?? systemScale;
        const fn = overrides?.systemFont ?? systemFont;
        const sl = overrides?.safetyLevel ?? safetyLevel;

        if (key && key.trim()) {
          await window.oro.saveProviderKey(p, key.trim());
        }
        await window.oro.saveProviderModel(p, m, bUrl.trim() || undefined, eff);

        const updated = await window.oro.saveConfig({
          provider: p,
          userInstructions: inst.trim(),
          safetyLevel: sl,
          ui: {
            ...config.ui,
            theme: th,
            systemScale: sc,
            systemFont: fn,
          },
        });

        try {
          localStorage.setItem("oro_theme", th);
          localStorage.setItem("oro_system_scale", String(sc));
          localStorage.setItem("oro_system_font", fn);
        } catch {}

        onConfigUpdated(updated);
        setSaveStatus("saved");
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          setSaveStatus("idle");
        }, 1800);
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus("error");
      }
    },
    [
      activeProvider,
      selectedModel,
      reasoningEffort,
      baseUrl,
      apiKey,
      userInstructions,
      theme,
      systemScale,
      systemFont,
      config,
      onConfigUpdated,
    ]
  );

  // Debounced auto-save for text inputs
  const triggerDebouncedSave = (patch: Parameters<typeof performSave>[0]) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      performSave(patch);
    }, 600);
  };

  const handleProviderChange = (newP: ProviderId) => {
    setActiveProvider(newP);
    const newSpec = PROVIDERS.find((p) => p.id === newP) || PROVIDERS[0]!;
    const newBaseUrl = config.providers[newP]?.baseUrl || "";
    const newModel = config.providers[newP]?.model || newSpec.defaultModel;
    const newEffort = config.providers[newP]?.reasoningEffort || "medium";
    setBaseUrl(newBaseUrl);
    setApiKey("");
    setSelectedModel(newModel);
    setReasoningEffort(newEffort);

    performSave({
      provider: newP,
      baseUrl: newBaseUrl,
      model: newModel,
      reasoningEffort: newEffort,
    });
  };

  const handleModelChange = (newModel: string) => {
    setSelectedModel(newModel);
    performSave({ model: newModel });
  };

  const handleEffortChange = (newEffort: "low" | "medium" | "high") => {
    setReasoningEffort(newEffort);
    performSave({ reasoningEffort: newEffort });
  };

  const handleSafetyChange = (newSafety: "autonomous" | "confirm_destructive" | "strict") => {
    setSafetyLevel(newSafety);
    performSave({ safetyLevel: newSafety });
  };

  const handleThemeChange = (newTheme: "dark" | "light" | "monokai") => {
    setTheme(newTheme);
    applyLiveAppearance(newTheme, systemScale, systemFont);
    performSave({ theme: newTheme });
  };

  const handleScaleChange = (newScale: number) => {
    setSystemScale(newScale);
    applyLiveAppearance(theme, newScale, systemFont);
    performSave({ systemScale: newScale });
  };

  const handleFontChange = (newFont: string) => {
    setSystemFont(newFont);
    applyLiveAppearance(theme, systemScale, newFont);
    performSave({ systemFont: newFont });
  };

  const handleOpenFolder = () => {
    if (workspace?.root) {
      window.oro.openExternal(workspace.root);
    }
  };

  const handlePickFolder = async () => {
    const selected = await window.oro.selectWorkspaceFolder();
    if (selected) {
      onSwitchWorkspace(selected);
    }
  };

  // Keyboard shortcut: Escape to close
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content settings-modal-window"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Navigation Sidebar */}
        <div
          style={{
            width: 185,
            flexShrink: 0,
            background: "var(--bg-canvas)",
            borderRight: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            padding: "14px 10px",
            userSelect: "none",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 8px 14px 8px" }}>
            <Sliders size={13} style={{ color: "var(--cyan)" }} />
            <span style={{ fontSize: 13, fontWeight: 650, color: "var(--text)", letterSpacing: "-0.01em" }}>Settings</span>
          </div>

          {/* List Navigation */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-nav-item ${isActive ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.id as any)}
                >
                  <TabIcon
                    size={13.5}
                    style={{
                      color: isActive ? "var(--cyan)" : "var(--text-subtle)",
                      flexShrink: 0,
                    }}
                  />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Sidebar Footer with Auto-Save Indicator */}
          <div
            style={{
              padding: "10px 8px 2px 8px",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>Auto-Save</span>
            {saveStatus === "saving" && (
              <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--text-subtle)" }}>
                <Loader2 size={10} className="spin" />
                <span>Saving…</span>
              </span>
            )}
            {saveStatus === "saved" && (
              <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--green)" }}>
                <Check size={10} strokeWidth={2.5} />
                <span>Saved</span>
              </span>
            )}
            {saveStatus === "error" && (
              <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "var(--red)" }}>
                <AlertCircle size={10} />
                <span>Error</span>
              </span>
            )}
            {saveStatus === "idle" && (
              <span style={{ fontSize: 10, color: "var(--text-subtle)" }}>Ready</span>
            )}
          </div>
        </div>

        {/* Right Settings Content Area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            height: "100%",
            background: "var(--modal-bg)",
          }}
        >
          {/* Header */}
          <div
            style={{
              height: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "0 18px",
              borderBottom: "1px solid var(--border-subtle)",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>
              {TABS.find((t) => t.id === activeTab)?.label}
            </span>
            <button
              className="unified-btn"
              onClick={onClose}
              title="Close (Esc)"
              style={{ width: 22, height: 22, padding: 0, borderRadius: 9999 }}
            >
              <X size={13} />
            </button>
          </div>

          {/* Scrollable List Body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* TAB 1: AI & MODELS */}
            {activeTab === "ai" && (
              <div className="settings-list-group">
                {/* Row: Active Provider */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">Active AI Provider</span>
                    <span className="settings-list-subtitle">Service for reasoning & second brain</span>
                  </div>
                  <div className="settings-list-control">
                    <div style={{ display: "inline-flex", background: "var(--hover-overlay)", padding: 2, borderRadius: 9999, gap: 1 }}>
                      {PROVIDERS.map((p) => {
                        const isSelected = p.id === activeProvider;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => handleProviderChange(p.id)}
                            style={{
                              padding: "3px 8px",
                              borderRadius: 9999,
                              border: "none",
                              fontSize: 10.5,
                              fontWeight: isSelected ? 600 : 400,
                              background: isSelected ? "var(--active-overlay)" : "transparent",
                              color: isSelected ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              transition: "all 0.12s ease",
                            }}
                          >
                            {p.label.split(" ")[0]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Row: API Key or Ollama Host */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">
                      {activeProvider === "ollama" ? "Ollama Host URL" : "API Key"}
                    </span>
                    <span className="settings-list-subtitle">
                      {activeProvider === "ollama" ? "Local server HTTP address" : `Key for ${providerSpec.label}`}
                    </span>
                  </div>
                  <div className="settings-list-control" style={{ width: 180 }}>
                    {activeProvider === "ollama" ? (
                      <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => {
                          setBaseUrl(e.target.value);
                          triggerDebouncedSave({ baseUrl: e.target.value });
                        }}
                        onBlur={() => performSave({ baseUrl })}
                        placeholder="http://localhost:11434"
                        style={{
                          width: "100%",
                          background: "var(--input-bg, var(--bg-canvas))",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: "4px 8px",
                          color: "var(--text)",
                          fontSize: 11,
                          outline: "none",
                        }}
                      />
                    ) : (
                      <div style={{ position: "relative", width: "100%", display: "flex", alignItems: "center" }}>
                        <input
                          type={showKey ? "text" : "password"}
                          value={apiKey}
                          onChange={(e) => {
                            setApiKey(e.target.value);
                            triggerDebouncedSave({ apiKey: e.target.value });
                          }}
                          onBlur={() => {
                            if (apiKey.trim()) performSave({ apiKey });
                          }}
                          placeholder={currentSavedKey ? "•••••••••••• (Saved)" : `Paste key`}
                          style={{
                            width: "100%",
                            background: "var(--input-bg, var(--bg-canvas))",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: "4px 24px 4px 8px",
                            color: "var(--text)",
                            fontSize: 11,
                            outline: "none",
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          style={{
                            position: "absolute",
                            right: 4,
                            background: "transparent",
                            border: "none",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            padding: 2,
                            display: "flex",
                          }}
                        >
                          {showKey ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Row: Default Model */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">Default Model</span>
                    <span className="settings-list-subtitle">Model used for planning and tasks</span>
                  </div>
                  <div className="settings-list-control" style={{ width: 180 }}>
                    <select
                      value={selectedModel}
                      onChange={(e) => handleModelChange(e.target.value)}
                      style={{
                        width: "100%",
                        background: "var(--input-bg, var(--bg-canvas))",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "4px 8px",
                        color: "var(--text)",
                        fontSize: 11,
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      {dynamicModels.length > 0 ? (
                        dynamicModels.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.id} {m.tag ? `[${m.tag}]` : ""}
                          </option>
                        ))
                      ) : (
                        <>
                          <option value={selectedModel}>
                            {isLoadingModels ? "Loading models..." : selectedModel}
                          </option>
                          {activeProvider === "gemini" && (
                            <>
                              <option value="gemini-3.8-flash">Gemini 3.8 Flash [Fast]</option>
                              <option value="gemini-flash-latest">Gemini Flash Latest [Fast]</option>
                              <option value="gemini-pro-latest">Gemini Pro Latest [Reasoning]</option>
                              <option value="gemini-flash-lite-latest">Gemini Flash-Lite Latest [Ultra-Fast]</option>
                              <option value="gemini-3.5-flash">Gemini 3.5 Flash [Fast]</option>
                              <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite [Ultra-Fast]</option>
                            </>
                          )}
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {/* Row: Reasoning Effort */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">Reasoning Effort</span>
                    <span className="settings-list-subtitle">Depth of internal thinking tokens</span>
                  </div>
                  <div className="settings-list-control">
                    <div style={{ display: "inline-flex", background: "var(--hover-overlay)", padding: 2, borderRadius: 9999, gap: 1 }}>
                      {(["low", "medium", "high"] as const).map((lvl) => {
                        const isEffortActive = reasoningEffort === lvl;
                        return (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => handleEffortChange(lvl)}
                            style={{
                              padding: "3px 9px",
                              borderRadius: 9999,
                              border: "none",
                              fontSize: 10.5,
                              fontWeight: isEffortActive ? 600 : 400,
                              background: isEffortActive ? "var(--active-overlay)" : "transparent",
                              color: isEffortActive ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              textTransform: "capitalize",
                              transition: "all 0.12s ease",
                            }}
                          >
                            {lvl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Row: Safety & Permission Level */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">Safety & Autonomy Gate</span>
                    <span className="settings-list-subtitle">Agent tool permissions and mutation confirmation</span>
                  </div>
                  <div className="settings-list-control">
                    <div style={{ display: "inline-flex", background: "var(--hover-overlay)", padding: 2, borderRadius: 9999, gap: 1 }}>
                      {[
                        { id: "autonomous", label: "Autonomous" },
                        { id: "confirm_destructive", label: "Confirm Delete" },
                        { id: "strict", label: "Strict Review" },
                      ].map((lvl) => {
                        const isLevelActive = (safetyLevel || "autonomous") === lvl.id;
                        return (
                          <button
                            key={lvl.id}
                            type="button"
                            onClick={() => handleSafetyChange(lvl.id as any)}
                            style={{
                              padding: "3px 9px",
                              borderRadius: 9999,
                              border: "none",
                              fontSize: 10.5,
                              fontWeight: isLevelActive ? 600 : 400,
                              background: isLevelActive ? "var(--active-overlay)" : "transparent",
                              color: isLevelActive ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              transition: "all 0.12s ease",
                            }}
                          >
                            {lvl.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Row: Custom Instructions */}
                <div className="settings-list-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                  <div className="settings-list-info">
                    <span className="settings-list-title">Agent Custom Instructions</span>
                    <span className="settings-list-subtitle">Rules appended to all assistant prompts</span>
                  </div>
                  <textarea
                    rows={3}
                    value={userInstructions}
                    onChange={(e) => {
                      setUserInstructions(e.target.value);
                      triggerDebouncedSave({ userInstructions: e.target.value });
                    }}
                    onBlur={() => performSave({ userInstructions })}
                    placeholder="e.g. Keep responses direct and concise. Use [[wiki-links]] when referencing notes."
                    style={{
                      width: "100%",
                      background: "var(--input-bg, var(--bg-canvas))",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "6px 8px",
                      color: "var(--text)",
                      fontSize: 11,
                      lineHeight: 1.45,
                      resize: "vertical",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
              </div>
            )}

            {/* TAB 2: APPEARANCE */}
            {activeTab === "appearance" && (
              <div className="settings-list-group">
                {/* Row: Application Theme */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">Application Theme</span>
                    <span className="settings-list-subtitle">Light or dark interface color mode</span>
                  </div>
                  <div className="settings-list-control">
                    <div style={{ display: "inline-flex", background: "var(--hover-overlay)", padding: 2, borderRadius: 9999, gap: 1 }}>
                      <button
                        type="button"
                        onClick={() => handleThemeChange("dark")}
                        style={{
                          padding: "3px 10px",
                          borderRadius: 9999,
                          border: "none",
                          fontSize: 11,
                          fontWeight: theme === "dark" ? 600 : 400,
                          background: theme === "dark" ? "var(--active-overlay)" : "transparent",
                          color: theme === "dark" ? "var(--text)" : "var(--text-muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          cursor: "pointer",
                        }}
                      >
                        <Moon size={11.5} />
                        <span>Dark</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleThemeChange("light")}
                        style={{
                          padding: "3px 10px",
                          borderRadius: 9999,
                          border: "none",
                          fontSize: 11,
                          fontWeight: theme === "light" ? 600 : 400,
                          background: theme === "light" ? "var(--active-overlay)" : "transparent",
                          color: theme === "light" ? "var(--text)" : "var(--text-muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          cursor: "pointer",
                        }}
                      >
                        <Sun size={11.5} />
                        <span>Light</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleThemeChange("monokai")}
                        style={{
                          padding: "3px 10px",
                          borderRadius: 9999,
                          border: "none",
                          fontSize: 11,
                          fontWeight: theme === "monokai" ? 600 : 400,
                          background: theme === "monokai" ? "var(--active-overlay)" : "transparent",
                          color: theme === "monokai" ? "var(--text)" : "var(--text-muted)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          cursor: "pointer",
                        }}
                      >
                        <Palette size={11.5} />
                        <span>Monokai</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Row: Interface Scale */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">Interface Scale</span>
                    <span className="settings-list-subtitle">Overall application zoom</span>
                  </div>
                  <div className="settings-list-control">
                    <div style={{ display: "inline-flex", gap: 3 }}>
                      {ALLOWED_SCALES.map((sc) => (
                        <button
                          key={sc}
                          type="button"
                          onClick={() => handleScaleChange(sc)}
                          className={`unified-chip ${systemScale === sc ? "active" : ""}`}
                          style={{
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: systemScale === sc ? 600 : 400,
                          }}
                        >
                          {sc}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Row: System Font Family */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">UI Font Family</span>
                    <span className="settings-list-subtitle">Primary typeface across the application</span>
                  </div>
                  <div className="settings-list-control" style={{ width: 160 }}>
                    <select
                      value={systemFont}
                      onChange={(e) => handleFontChange(e.target.value)}
                      style={{
                        width: "100%",
                        background: "var(--input-bg, var(--bg-canvas))",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "4px 8px",
                        color: "var(--text)",
                        fontSize: 11,
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: WORKSPACE VAULT */}
            {activeTab === "vault" && (
              <div className="settings-list-group">
                {/* Row: Vault Location */}
                <div className="settings-list-row">
                  <div className="settings-list-info" style={{ paddingRight: 10 }}>
                    <span className="settings-list-title">Current Workspace Vault</span>
                    <span className="settings-list-subtitle" style={{ wordBreak: "break-all" }}>
                      {workspace?.root || "Default Vault (OroBrain)"}
                    </span>
                  </div>
                  <div className="settings-list-control" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="unified-btn"
                      onClick={handleOpenFolder}
                      title="Reveal in File Explorer"
                      style={{ height: 26, fontSize: 11, padding: "0 8px", gap: 4 }}
                    >
                      <FolderOpen size={12} />
                      <span>Open</span>
                    </button>
                    <button
                      type="button"
                      className="unified-btn"
                      onClick={handlePickFolder}
                      title="Select another folder as vault"
                      style={{ height: 26, fontSize: 11, padding: "0 8px" }}
                    >
                      <span>Switch</span>
                    </button>
                  </div>
                </div>

                {/* Row: Note Indexing */}
                <div className="settings-list-row">
                  <div className="settings-list-info">
                    <span className="settings-list-title">Full-Text Search Engine</span>
                    <span className="settings-list-subtitle">Local SQLite FTS5 index for fast neural search</span>
                  </div>
                  <div className="settings-list-control">
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10.5,
                        fontWeight: 500,
                        color: "var(--green)",
                        background: "rgba(34, 197, 94, 0.10)",
                        padding: "2px 7px",
                        borderRadius: 9999,
                      }}
                    >
                      <ShieldCheck size={11} />
                      <span>Active</span>
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
