import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OroConfig, ProviderId } from "../types.js";

export const DEFAULT_MODELS: Record<ProviderId, string[]> = {
  gemini: ["gemini-3.8-flash", "gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.1-flash-lite"],
  openai: ["gpt-4o-mini", "gpt-4o", "o3-mini", "o1"],
  anthropic: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-sonnet-4-20250514"],
  ollama: ["llama3.2", "qwen2.5-coder:7b", "deepseek-r1:8b", "mistral"],
};

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpenedAt: string;
}

export const DEFAULT_CONFIG: OroConfig = {
  provider: "gemini",
  providers: {
    gemini: {
      model: "gemini-3.8-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    },
    openai: {
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    },
    anthropic: {
      model: "claude-3-7-sonnet-latest",
      baseUrl: "https://api.anthropic.com/v1",
    },
    ollama: {
      model: "llama3.2",
      baseUrl: "http://localhost:11434",
    },
  },
  defaultMode: "default",
  maxAgentSteps: 12,
  autoIndex: true,
  safetyLevel: "autonomous",
  editor: {
    fontSize: 13,
    fontPreset: "sans",
    wordWrap: "on",
    minimap: false,
    lineNumbers: "on",
    defaultView: "split",
  },
  ui: {
    theme: "dark",
    systemFont: "default",
    systemFontSize: 12,
    systemScale: 100,
  },
};

export function getGlobalConfigDir(): string {
  return path.join(os.homedir(), ".oro");
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), "config.json");
}

export function getRecentWorkspacesPath(): string {
  return path.join(getGlobalConfigDir(), "recent.json");
}

export function getDefaultBrainPath(): string {
  const globalCfg = readJsonSafeRaw(getGlobalConfigPath());
  if (typeof globalCfg.defaultVaultPath === "string" && globalCfg.defaultVaultPath.trim()) {
    return path.resolve(globalCfg.defaultVaultPath.trim());
  }
  return path.join(os.homedir(), "OroBrain");
}

export function saveDefaultBrainPath(vaultPath: string): void {
  const dir = getGlobalConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getGlobalConfigPath();
  const current = readJsonSafeRaw(filePath);
  current.defaultVaultPath = path.resolve(vaultPath);
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2), "utf8");
}

export function getWorkspaceOroDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".oro");
}

export function getWorkspaceConfigPath(workspaceRoot: string): string {
  return path.join(getWorkspaceOroDir(workspaceRoot), "config.json");
}

function readJsonSafeRaw(filePath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readJsonSafe(filePath: string): Partial<OroConfig> {
  return readJsonSafeRaw(filePath) as Partial<OroConfig>;
}

export function loadRecentWorkspaces(): RecentWorkspace[] {
  try {
    const filePath = getRecentWorkspacesPath();
    if (!fs.existsSync(filePath)) return [];
    const arr = JSON.parse(fs.readFileSync(filePath, "utf8")) as RecentWorkspace[];
    if (!Array.isArray(arr)) return [];
    return arr.filter((w) => w && typeof w.path === "string" && fs.existsSync(w.path));
  } catch {
    return [];
  }
}

export function recordRecentWorkspace(workspaceRoot: string): RecentWorkspace[] {
  const abs = path.resolve(workspaceRoot);
  const existing = loadRecentWorkspaces().filter(
    (w) => w.path.toLowerCase() !== abs.toLowerCase()
  );
  const next: RecentWorkspace[] = [
    {
      path: abs,
      name: path.basename(abs) || abs,
      lastOpenedAt: new Date().toISOString(),
    },
    ...existing,
  ].slice(0, 12);

  try {
    fs.mkdirSync(getGlobalConfigDir(), { recursive: true });
    fs.writeFileSync(getRecentWorkspacesPath(), JSON.stringify(next, null, 2), "utf8");
  } catch {
    // ignore write failures
  }
  return next;
}

export function loadConfig(workspaceRoot: string): OroConfig {
  const globalCfg = readJsonSafe(getGlobalConfigPath());
  const wsCfg = readJsonSafe(getWorkspaceConfigPath(workspaceRoot));

  const merged: OroConfig = {
    provider: wsCfg.provider ?? globalCfg.provider ?? DEFAULT_CONFIG.provider,
    defaultMode: wsCfg.defaultMode ?? globalCfg.defaultMode ?? DEFAULT_CONFIG.defaultMode,
    maxAgentSteps: wsCfg.maxAgentSteps ?? globalCfg.maxAgentSteps ?? DEFAULT_CONFIG.maxAgentSteps,
    autoIndex: wsCfg.autoIndex ?? globalCfg.autoIndex ?? DEFAULT_CONFIG.autoIndex,
    defaultVaultPath: (globalCfg as any).defaultVaultPath ?? getDefaultBrainPath(),
    editor: {
      ...DEFAULT_CONFIG.editor,
      ...globalCfg.editor,
      ...wsCfg.editor,
    },
    ui: {
      ...DEFAULT_CONFIG.ui,
      ...globalCfg.ui,
      ...wsCfg.ui,
    },
    providers: {
      gemini: {
        ...DEFAULT_CONFIG.providers.gemini,
        ...globalCfg.providers?.gemini,
        ...wsCfg.providers?.gemini,
      },
      openai: {
        ...DEFAULT_CONFIG.providers.openai,
        ...globalCfg.providers?.openai,
        ...wsCfg.providers?.openai,
      },
      anthropic: {
        ...DEFAULT_CONFIG.providers.anthropic,
        ...globalCfg.providers?.anthropic,
        ...wsCfg.providers?.anthropic,
      },
      ollama: {
        ...DEFAULT_CONFIG.providers.ollama,
        ...globalCfg.providers?.ollama,
        ...wsCfg.providers?.ollama,
      },
    },
  };

  const envGemini = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const envOpenAI = process.env.OPENAI_API_KEY;
  const envAnthropic = process.env.ANTHROPIC_API_KEY;
  const envOllama = process.env.OLLAMA_HOST;

  if (envGemini && !merged.providers.gemini.apiKey) {
    merged.providers.gemini.apiKey = envGemini;
  }
  if (envOpenAI && !merged.providers.openai.apiKey) {
    merged.providers.openai.apiKey = envOpenAI;
  }
  if (envAnthropic && !merged.providers.anthropic.apiKey) {
    merged.providers.anthropic.apiKey = envAnthropic;
  }
  if (envOllama) {
    merged.providers.ollama.baseUrl = envOllama;
  }
  if (process.env.OPENAI_BASE_URL) {
    merged.providers.openai.baseUrl = process.env.OPENAI_BASE_URL;
  }

  const hasExplicitProvider = Boolean(wsCfg.provider || globalCfg.provider);
  if (!hasExplicitProvider) {
    if (merged.providers.gemini.apiKey) merged.provider = "gemini";
    else if (merged.providers.openai.apiKey) merged.provider = "openai";
    else if (merged.providers.anthropic.apiKey) merged.provider = "anthropic";
  }

  return merged;
}

export function saveProviderKey(provider: ProviderId, apiKey: string): void {
  const dir = getGlobalConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getGlobalConfigPath();
  const current = readJsonSafe(filePath);
  const existingProviders = (current.providers ?? {}) as Partial<OroConfig["providers"]>;
  const prevProvider = existingProviders[provider] ?? DEFAULT_CONFIG.providers[provider];
  const next = {
    ...current,
    provider,
    providers: {
      ...existingProviders,
      [provider]: {
        ...prevProvider,
        apiKey,
      },
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
}

export function saveProviderModel(
  provider: ProviderId,
  model: string,
  baseUrl?: string,
  reasoningEffort?: "low" | "medium" | "high"
): void {
  const dir = getGlobalConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getGlobalConfigPath();
  const current = readJsonSafe(filePath);
  const existingProviders = (current.providers ?? {}) as Partial<OroConfig["providers"]>;
  const prevProvider = existingProviders[provider] ?? DEFAULT_CONFIG.providers[provider];
  const next = {
    ...current,
    provider,
    providers: {
      ...existingProviders,
      [provider]: {
        ...prevProvider,
        model,
        ...(baseUrl ? { baseUrl } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      },
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
}

export function saveGlobalConfig(patch: Partial<OroConfig>): void {
  const dir = getGlobalConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const filePath = getGlobalConfigPath();
  const current = readJsonSafe(filePath);
  const next = {
    ...current,
    ...patch,
    providers: {
      ...current.providers,
      ...patch.providers,
    },
    editor: {
      ...current.editor,
      ...patch.editor,
    },
    ui: {
      ...current.ui,
      ...patch.ui,
    },
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
}

export function isProviderReady(config: OroConfig, provider: ProviderId = config.provider): boolean {
  if (provider === "ollama") return true;
  return Boolean(config.providers[provider]?.apiKey?.trim());
}

export interface ModelOption {
  id: string;
  name: string;
  tag?: string;
}

/**
 * Dynamically queries the provider's API with the provided key to list all accessible models.
 */
export async function fetchProviderModels(
  provider: ProviderId,
  apiKey?: string,
  baseUrl?: string
): Promise<ModelOption[]> {
  const cleanKey = apiKey?.trim();

  // 1. OLLAMA
  if (provider === "ollama") {
    const host = (baseUrl || "http://localhost:11434").replace(/\/+$/, "");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1400);
      const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      return (json.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => Boolean(n))
        .filter((name) => {
          const lower = name.toLowerCase();
          return (
            !lower.includes("embed") &&
            !lower.includes("bge-") &&
            !lower.includes("minilm")
          );
        })
        .map((name) => ({
          id: name,
          name,
          tag: name.includes("coder") ? "Code" : name.includes("r1") ? "Reasoning" : "Local",
        }));
    } catch {
      return [];
    }
  }

  // If no API key provided, return empty
  if (!cleanKey) return [];

  // 2. GOOGLE GEMINI
  if (provider === "gemini") {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`,
        { signal: controller.signal }
      );
      clearTimeout(timer);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        models?: Array<{
          name: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
      };

      // Strict patterns for non-chat, non-usable specialized endpoints, experimental checkpoints,
      // and deprecated model versions (Gemini 1.x and 2.x are no longer available to new users)
      const unusableGeminiPatterns = [
        /\bgemini-[12]\./i,
        /\btts\b|-tts\b|-tts-/i,
        /\bimage\b|-image\b|-image-/i,
        /\bbanana\b/i,
        /\btranscribe\b/i,
        /\blyria\b/i,
        /\brobotics\b/i,
        /\bcomputer-use\b/i,
        /\bembedding\b|\bembed\b/i,
        /\baqa\b/i,
        /\bdeep-research\b/i,
        /\bantigravity\b/i,
        /\b(argon|carbon|hydrogen|neon)\b/i,
        /-customtools\b/i,
        /\bgemma\b/i,
      ];

      const list: ModelOption[] = [];
      for (const m of json.models || []) {
        if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
        const cleanId = m.name.replace(/^models\//, "");

        // Filter out non-usable specialized endpoints and previews
        if (unusableGeminiPatterns.some((pat) => pat.test(cleanId))) {
          continue;
        }

        let cleanName = m.displayName || cleanId;
        cleanName = cleanName
          .replace(/\s+Latest$/i, "")
          .replace(/^models\//i, "");

        const tag = cleanId.includes("flash-lite")
          ? "Ultra-Fast"
          : cleanId.includes("pro")
          ? "Reasoning"
          : cleanId.includes("flash")
          ? "Fast"
          : "General";
        list.push({ id: cleanId, name: cleanName, tag });
      }

      list.sort((a, b) => {
        const score = (id: string) => {
          let s = 0;
          if (id === "gemini-3.8-flash") return 5000;
          if (id === "gemini-flash-latest") return 4900;
          if (id === "gemini-pro-latest") return 4800;
          if (id === "gemini-flash-lite-latest") return 4700;
          if (id === "gemini-3.5-flash") return 4600;
          if (id === "gemini-3.1-flash-lite") return 4500;
          if (id === "gemini-3.1-pro-preview") return 4400;
          if (id === "gemini-3-flash-preview") return 4300;

          if (id.includes("3.8")) s += 3800;
          else if (id.includes("3.5")) s += 3500;
          else if (id.includes("3.1")) s += 3100;
          else if (id.includes("3.")) s += 3000;
          else s += 1000;

          if (id.includes("flash-lite")) s += 80;
          else if (id.includes("flash")) s += 120;
          else if (id.includes("pro")) s += 100;

          if (/\d{4}-\d{2}|\d{8}/.test(id)) s -= 200;
          if (id.includes("exp") || id.includes("preview")) s -= 50;
          return s;
        };
        return score(b.id) - score(a.id);
      });

      return list.slice(0, 10);
    } catch {
      return [];
    }
  }

  // 3. OPENAI / OPENAI-COMPATIBLE
  if (provider === "openai") {
    const host = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(`${host}/models`, {
        headers: {
          Authorization: `Bearer ${cleanKey}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      const raw = json.data || [];
      const list: ModelOption[] = [];

      for (const item of raw) {
        const id = item.id.toLowerCase();
        // Exclude non-chat / non-usable endpoints
        if (
          id.includes("whisper") ||
          id.includes("tts") ||
          id.includes("dall-e") ||
          id.includes("embedding") ||
          id.includes("moderation") ||
          id.includes("realtime") ||
          id.includes("audio") ||
          id.includes("instruct") ||
          id.includes("babbage") ||
          id.includes("davinci") ||
          id.includes("search") ||
          id.includes("similarity")
        ) {
          continue;
        }

        if (host.includes("api.openai.com")) {
          if (
            !id.startsWith("gpt-") &&
            !id.startsWith("o1") &&
            !id.startsWith("o3") &&
            !id.startsWith("chatgpt-")
          ) {
            continue;
          }
        }

        const tag = id.includes("mini") || id.includes("flash") || id.includes("nano")
          ? "Fast"
          : id.startsWith("o1") || id.startsWith("o3") || id.includes("r1")
          ? "Reasoning"
          : "Smart";
        list.push({ id: item.id, name: item.id, tag });
      }

      list.sort((a, b) => {
        const score = (id: string) => {
          let s = 0;
          if (id.includes("gpt-4o")) s += 100;
          if (id.includes("o3")) s += 90;
          if (id.includes("o1")) s += 80;
          if (id.includes("mini")) s += 10;
          return s;
        };
        return score(b.id) - score(a.id);
      });

      return list.slice(0, 5);
    } catch {
      return [];
    }
  }

  // 4. ANTHROPIC CLAUDE
  if (provider === "anthropic") {
    const host = (baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(`${host}/models`, {
        headers: {
          "x-api-key": cleanKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
        if (Array.isArray(json.data) && json.data.length > 0) {
          return json.data.map((m) => ({
            id: m.id,
            name: m.display_name || m.id,
            tag: m.id.includes("haiku") ? "Fast" : m.id.includes("sonnet") ? "Smart" : "Reasoning",
          }));
        }
      }
    } catch {}

    // Curated models for Anthropic if models listing not permitted
    return [
      { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet", tag: "Smart" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet", tag: "Smart" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", tag: "Fast" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tag: "Reasoning" },
    ];
  }

  return [];
}

/**
 * Fetches locally installed Ollama model names if Ollama is running (fast timeout).
 */
export async function fetchOllamaModels(baseUrl = "http://localhost:11434"): Promise<string[]> {
  const models = await fetchProviderModels("ollama", undefined, baseUrl);
  return models.map((m) => m.id);
}

/**
 * Opens a workspace file in the user's preferred external editor (VS Code, $EDITOR, or OS default).
 */
export function openInExternalEditor(absPath: string): string {
  const editor = process.env.VISUAL || process.env.EDITOR;
  try {
    if (editor) {
      const child = spawn(editor, [absPath], { detached: true, stdio: "ignore", shell: true });
      child.unref();
      return editor;
    }
    if (process.platform === "win32") {
      // Launch via Windows default association (VS Code / Obsidian / Notepad)
      const child = spawn("cmd", ["/c", "start", "", absPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return "default Windows editor";
    }
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    const child = spawn(opener, [absPath], { detached: true, stdio: "ignore" });
    child.unref();
    return opener;
  } catch (err) {
    throw new Error(`Could not open editor: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Reveals a file or folder in the OS native file explorer.
 */
export function revealInExplorer(targetPath: string): void {
  try {
    if (process.platform === "win32") {
      let isDir = false;
      try {
        isDir = fs.statSync(targetPath).isDirectory();
      } catch {}

      if (isDir) {
        const child = spawn("explorer.exe", [targetPath], { detached: true, stdio: "ignore" });
        child.unref();
      } else {
        const child = spawn("explorer.exe", [`/select,${targetPath}`], { detached: true, stdio: "ignore" });
        child.unref();
      }
    } else if (process.platform === "darwin") {
      const child = spawn("open", ["-R", targetPath], { detached: true, stdio: "ignore" });
      child.unref();
    } else {
      let isDir = false;
      try {
        isDir = fs.statSync(targetPath).isDirectory();
      } catch {}
      const dirToOpen = isDir ? targetPath : path.dirname(targetPath);
      const child = spawn("xdg-open", [dirToOpen], { detached: true, stdio: "ignore" });
      child.unref();
    }
  } catch (err) {
    console.error("revealInExplorer error:", err);
  }
}
