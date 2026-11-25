import type { OroConfig, ProviderId } from "../types.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createGeminiProvider } from "./gemini.js";
import { createOllamaProvider } from "./ollama.js";
import { createOpenAIProvider } from "./openai.js";
import type { LLMProvider } from "./types.js";

export function createProvider(config: OroConfig, overrideProvider?: ProviderId): LLMProvider {
  const id = overrideProvider ?? config.provider;
  const cfg = config.providers[id];

  switch (id) {
    case "gemini":
      return createGeminiProvider(cfg);
    case "openai":
      return createOpenAIProvider(cfg);
    case "anthropic":
      return createAnthropicProvider(cfg);
    case "ollama":
      return createOllamaProvider(cfg);
    default:
      throw new Error(`Unknown provider: ${String(id)}`);
  }
}
