import React, { useState, useEffect } from "react";
import { Sparkles, X, Check, Loader2, Key, Cpu, AlertCircle } from "lucide-react";
import type { OroConfig, ProviderId } from "../../types.js";

const PROVIDERS: Array<{ id: ProviderId; label: string; defaultModel: string; hint: string }> = [
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-3.8-flash", hint: "AI Studio API Key" },
  { id: "openai", label: "OpenAI / OpenRouter", defaultModel: "gpt-4o-mini", hint: "API Key (sk-...)" },
  { id: "anthropic", label: "Anthropic Claude", defaultModel: "claude-3-7-sonnet-latest", hint: "Claude API Key (sk-ant-...)" },
  { id: "ollama", label: "Ollama (Local)", defaultModel: "llama3.2", hint: "http://localhost:11434" },
];

interface ModelSetupModalProps {
  config: OroConfig;
  onClose: () => void;
  onSaved: () => void;
}

export const ModelSetupModal: React.FC<ModelSetupModalProps> = ({ config, onClose, onSaved }) => {
  const [provider, setProvider] = useState<ProviderId>(config.provider);
  const [model, setModel] = useState<string>(config.providers[config.provider]?.model || "gemini-3.8-flash");
  const [apiKey, setApiKey] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>(config.providers[config.provider]?.baseUrl || "");
  const [isSaving, setIsSaving] = useState(false);
  const [applyStatus, setApplyStatus] = useState<{
    status: "idle" | "pending" | "success" | "error";
    message?: string;
  }>({ status: "idle" });

  // Auto-loaded models state
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string; tag?: string }>>([]);
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const selectedSpec = PROVIDERS.find((p) => p.id === provider)!;
  const currentKey = config.providers[provider]?.apiKey;

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

  // Auto-fetch models when provider, key, or baseUrl changes
  useEffect(() => {
    let cancelled = false;
    const effectiveKey = apiKey.trim() || currentKey || "";

    if (provider !== "ollama" && !effectiveKey) {
      setAvailableModels([]);
      setFetchError(null);
      setIsLoadingModels(false);
      return;
    }

    setIsLoadingModels(true);
    setFetchError(null);

    const timer = setTimeout(async () => {
      try {
        const list = await window.oro.fetchProviderModels(provider, effectiveKey, baseUrl.trim() || undefined);
        if (!cancelled) {
          if (list && list.length > 0) {
            setAvailableModels(list);
            setFetchError(null);
            // If current model is empty or not in list, auto-select first recommended model
            if (!model || !list.some((m) => m.id === model)) {
              setModel(list[0]!.id);
            }
          } else {
            setAvailableModels([]);
            if (effectiveKey) {
              setFetchError("No models returned. Verify key permissions.");
            }
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setAvailableModels([]);
          setFetchError(err.message || "Failed to load models");
        }
      } finally {
        if (!cancelled) setIsLoadingModels(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [provider, apiKey, baseUrl, currentKey]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setApplyStatus({ status: "pending" });
    setIsSaving(true);
    try {
      const effectiveKey = apiKey.trim() || currentKey || "";
      if (provider !== "ollama" && !effectiveKey) {
        setApplyStatus({
          status: "error",
          message: `API key is required for ${selectedSpec.label}`,
        });
        setIsSaving(false);
        return;
      }

      if (apiKey.trim()) {
        await window.oro.saveProviderKey(provider, apiKey.trim());
      }
      const chosenModel = model.trim() || selectedSpec.defaultModel;
      await window.oro.saveProviderModel(
        provider,
        chosenModel,
        baseUrl.trim() || undefined
      );

      // If active fetch error is present, warn user that validation failed
      if (fetchError) {
        setApplyStatus({
          status: "error",
          message: `Apply Failed: API rejected key or server unreachable (${fetchError})`,
        });
        setIsSaving(false);
        return;
      }

      setApplyStatus({
        status: "success",
        message: `Apply Succeeded! Connected to ${selectedSpec.label} (${chosenModel})`,
      });
      onSaved();
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err: any) {
      setApplyStatus({
        status: "error",
        message: `Apply Failed: ${err?.message || "Failed to save configuration"}`,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7, color: "var(--accent)" }}>
            <Sparkles size={16} />
            Connect AI Model
          </div>
          <button className="btn" onClick={onClose} style={{ padding: 4 }}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSave} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 1. Provider Select */}
          <div>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              AI Provider
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {PROVIDERS.map((p) => {
                const isSelected = p.id === provider;
                const hasKey = p.id === "ollama" || Boolean(config.providers[p.id]?.apiKey);
                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      setProvider(p.id);
                      setModel(config.providers[p.id]?.model || p.defaultModel);
                      setBaseUrl(config.providers[p.id]?.baseUrl || "");
                      setApiKey("");
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                      background: isSelected ? "rgba(255, 255, 255, 0.06)" : "transparent",
                      color: isSelected ? "#ffffff" : "var(--text)",
                      cursor: "pointer",
                      fontSize: 12.5,
                      fontWeight: isSelected ? 600 : 400,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{p.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {hasKey && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} title="Configured" />}
                      {isSelected && <Check size={14} style={{ color: "var(--accent)" }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. API Key Input */}
          {provider !== "ollama" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  API Key {currentKey ? <span style={{ color: "var(--green)" }}>(Configured)</span> : <span style={{ color: "var(--orange)" }}>(Required)</span>}
                </label>
                {currentKey && !apiKey && (
                  <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>Key saved in vault config</span>
                )}
              </div>
              <div style={{ position: "relative" }}>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setApplyStatus({ status: "idle" });
                  }}
                  placeholder={currentKey ? "•••••••••••••••••••• (paste new key to update)" : `Enter your ${selectedSpec.hint}`}
                  style={{
                    width: "100%",
                    padding: "8px 10px 8px 32px",
                    borderRadius: 6,
                    background: "var(--bg-canvas)",
                    border: `1px solid ${
                      fetchError
                        ? "#ef4444"
                        : availableModels.length > 0
                        ? "#22c55e"
                        : "var(--border)"
                    }`,
                    color: "var(--text)",
                    fontSize: 13,
                    outline: "none",
                    transition: "border-color 0.2s ease",
                  }}
                />
                <Key size={14} style={{ position: "absolute", left: 10, top: 11, color: "var(--text-muted)" }} />
              </div>

              {/* Status indicator line directly below the API key input */}
              {isLoadingModels && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ height: 2, background: "var(--accent)", borderRadius: 1 }} />
                  <div style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                    <Loader2 size={11} className="spin" />
                    Connecting to {selectedSpec.label} and verifying key...
                  </div>
                </div>
              )}
              {!isLoadingModels && availableModels.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ height: 2, background: "#22c55e", borderRadius: 1, boxShadow: "0 0 8px rgba(34, 197, 94, 0.5)" }} />
                  <div style={{ fontSize: 11, color: "#22c55e", display: "flex", alignItems: "center", gap: 5, marginTop: 4, fontWeight: 500 }}>
                    <Check size={12} strokeWidth={2.5} />
                    Key verified — {availableModels.length} models accessible
                  </div>
                </div>
              )}
              {!isLoadingModels && fetchError && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ height: 2, background: "#ef4444", borderRadius: 1, boxShadow: "0 0 8px rgba(239, 68, 68, 0.5)" }} />
                  <div style={{ fontSize: 11, color: "#ef4444", display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                    <AlertCircle size={12} strokeWidth={2.5} />
                    Verification failed: {fetchError}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Optional Base URL (OpenAI custom / Ollama endpoint) */}
          {(provider === "openai" || provider === "ollama") && (
            <div>
              <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                {provider === "openai" ? "Base URL (optional, for OpenRouter / DeepSeek / LocalAI)" : "Ollama Endpoint"}
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={provider === "openai" ? "https://api.openai.com/v1" : "http://localhost:11434"}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 6,
                  background: "var(--bg-canvas)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: 12.5,
                  outline: "none",
                }}
              />
            </div>
          )}

          {/* 3. Available Models (Auto-detected from API Key) */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
                <Cpu size={12} />
                Available Models
              </label>
              {isLoadingModels && (
                <span style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Loader2 size={11} className="spin" />
                  Loading models from API...
                </span>
              )}
              {!isLoadingModels && availableModels.length > 0 && (
                <span style={{ fontSize: 11, color: "var(--green)" }}>
                  ✓ {availableModels.length} models detected
                </span>
              )}
              {!isLoadingModels && fetchError && (
                <span style={{ fontSize: 11, color: "var(--orange)", display: "flex", alignItems: "center", gap: 3 }}>
                  <AlertCircle size={10} />
                  {fetchError}
                </span>
              )}
            </div>

            {/* If models detected, show interactive selectable list */}
            {availableModels.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  maxHeight: 150,
                  overflowY: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 4,
                  background: "var(--bg-canvas)",
                }}
              >
                {availableModels.map((m) => {
                  const isSelected = m.id === model;
                  return (
                    <div
                      key={m.id}
                      onClick={() => setModel(m.id)}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "6px 8px",
                        borderRadius: 4,
                        cursor: "pointer",
                        background: isSelected ? "rgba(255, 255, 255, 0.08)" : "transparent",
                        color: isSelected ? "#ffffff" : "var(--text)",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ fontWeight: isSelected ? 600 : 400 }}>{m.name || m.id}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {m.tag && (
                          <span
                            style={{
                              fontSize: 9.5,
                              padding: "1px 5px",
                              borderRadius: 3,
                              background: "rgba(255, 255, 255, 0.06)",
                              color: "var(--text-subtle)",
                            }}
                          >
                            {m.tag}
                          </span>
                        )}
                        {isSelected && <Check size={12} style={{ color: "var(--accent)" }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : !isLoadingModels && !apiKey && !currentKey && provider !== "ollama" ? (
              <div
                style={{
                  fontSize: 11.5,
                  color: "var(--text-subtle)",
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "var(--bg-canvas)",
                  border: "1px dashed var(--border)",
                }}
              >
                Paste your API key above to automatically load your account's available models.
              </div>
            ) : null}

            {/* Custom Model Input */}
            <div style={{ marginTop: 8 }}>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={selectedSpec.defaultModel}
                style={{
                  width: "100%",
                  padding: "7px 10px",
                  borderRadius: 6,
                  background: "var(--bg-canvas)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  fontSize: 12.5,
                  outline: "none",
                }}
                title="Or type a custom model ID"
              />
            </div>
          </div>

          {/* Modal Action Buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button type="button" className="btn" onClick={onClose} disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Applying..." : "Save & Apply"}
            </button>
          </div>

          {/* Red or Green Line Below indicating if the Apply Succeeded or Failed */}
          {applyStatus.status === "success" && (
            <div style={{ marginTop: 6, animation: "fadeIn 0.2s ease" }}>
              <div
                style={{
                  height: 2.5,
                  background: "#22c55e",
                  borderRadius: 2,
                  boxShadow: "0 0 10px rgba(34, 197, 94, 0.7)",
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#22c55e",
                  fontSize: 12,
                  fontWeight: 500,
                  marginTop: 6,
                }}
              >
                <Check size={14} strokeWidth={2.5} />
                <span>{applyStatus.message || "Apply Succeeded! Provider connected and ready."}</span>
              </div>
            </div>
          )}

          {applyStatus.status === "error" && (
            <div style={{ marginTop: 6, animation: "fadeIn 0.2s ease" }}>
              <div
                style={{
                  height: 2.5,
                  background: "#ef4444",
                  borderRadius: 2,
                  boxShadow: "0 0 10px rgba(239, 68, 68, 0.7)",
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#ef4444",
                  fontSize: 12,
                  fontWeight: 500,
                  marginTop: 6,
                }}
              >
                <AlertCircle size={14} strokeWidth={2.5} />
                <span>{applyStatus.message || "Apply Failed! Please check your API key and connection."}</span>
              </div>
            </div>
          )}

          {applyStatus.status === "pending" && (
            <div style={{ marginTop: 6 }}>
              <div
                style={{
                  height: 2,
                  background: "var(--accent)",
                  borderRadius: 2,
                  opacity: 0.8,
                }}
              />
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--accent)",
                  fontSize: 11.5,
                  marginTop: 5,
                }}
              >
                <Loader2 size={12} className="spin" />
                <span>Applying configuration & testing connection...</span>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
