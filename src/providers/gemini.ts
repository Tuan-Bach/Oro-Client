import crypto from "node:crypto";
import type { ProviderConfig } from "../types.js";
import type { LLMChatParams, LLMMessage, LLMProvider, LLMStreamEvent, ToolDefinition } from "./types.js";

function toGeminiContents(messages: LLMMessage[]) {
  const contents: Array<{ role: "user" | "model"; parts: unknown[] }> = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      const parts: unknown[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const partObj: Record<string, unknown> = {
            functionCall: {
              name: tc.name,
              args: tc.args,
            },
            thoughtSignature: tc.thoughtSignature || "skip_thought_signature_validator",
          };
          parts.push(partObj);
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
    } else if (msg.role === "tool") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(msg.content);
      } catch {
        parsed = { output: msg.content };
      }
      const responseObj =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : { result: parsed };

      const prev = contents[contents.length - 1];
      const part = {
        functionResponse: {
          name: msg.toolName,
          response: responseObj,
        },
      };
      if (prev && prev.role === "user" && prev.parts.every((p) => typeof p === "object" && p !== null && "functionResponse" in p)) {
        prev.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
    }
  }

  return contents;
}

function toGeminiTools(tools: ToolDefinition[]) {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export function createGeminiProvider(cfg: ProviderConfig): LLMProvider {
  const apiKey = cfg.apiKey?.trim();
  const baseUrl = (cfg.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  const model = cfg.model || "gemini-3.8-flash";

  return {
    id: "gemini",
    model,
    async *streamChat(params: LLMChatParams): AsyncGenerator<LLMStreamEvent> {
      if (!apiKey) {
        throw new Error(
          "Gemini API key not configured. Run `/key gemini <YOUR_API_KEY>` or set GEMINI_API_KEY."
        );
      }

      const url = `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
      
      const effort = cfg.reasoningEffort || "medium";
      const generationConfig: Record<string, unknown> = {};

      const isFlash = model.includes("flash") || model.includes("lite");
      const isThinking = model.includes("thinking");
      const isPro = model.includes("pro");

      if (isThinking) {
        const budgetMap: Record<string, number> = {
          low: 1024,
          medium: 4096,
          high: 16384,
        };
        generationConfig.thinkingConfig = {
          thinkingBudget: budgetMap[effort] ?? 4096,
        };
      } else if (isPro) {
        const budgetMap: Record<string, number> = {
          low: 1024,
          medium: 2048,
          high: 8192,
        };
        generationConfig.thinkingConfig = {
          thinkingBudget: budgetMap[effort] ?? 2048,
        };
      } else if (isFlash) {
        // Flash models are built for ultra-fast, sub-second responses in agent workflows.
        // If 'high' reasoning effort is selected, allocate a light budget (2048).
        // For lite models (model.includes("lite")), thinkingConfig is unsupported and must be omitted.
        // For other flash models with 'low' or 'medium', set thinkingBudget: 0 to disable thinking.
        if (effort === "high") {
          generationConfig.thinkingConfig = { thinkingBudget: 2048 };
        } else if (!model.includes("lite")) {
          generationConfig.thinkingConfig = { thinkingBudget: 0 };
        }
      } else if (effort === "low") {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }

      const body: Record<string, unknown> = {
        systemInstruction: {
          parts: [{ text: params.systemPrompt }],
        },
        contents: toGeminiContents(params.messages),
        tools: toGeminiTools(params.tools),
      };

      if (Object.keys(generationConfig).length > 0) {
        body.generationConfig = generationConfig;
      }

      let res: Response | null = null;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (params.signal?.aborted) break;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: params.signal,
        });

        if (resp.ok) {
          res = resp;
          break;
        }

        const isTransient = resp.status === 503 || resp.status === 429;
        if (isTransient && attempt < maxRetries) {
          const backoffMs = attempt * 1500 + Math.random() * 500;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        const errText = await resp.text().catch(() => resp.statusText);
        throw new Error(`Gemini API error (${resp.status}): ${errText.slice(0, 300)}`);
      }

      if (!res || !res.body) {
        throw new Error("Gemini API returned empty stream body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIdx: number;
        while ((nlIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIdx).trim();
          buffer = buffer.slice(nlIdx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          let json: Record<string, unknown>;
          try {
            json = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue;
          }

          const candidates = json.candidates as Array<Record<string, unknown>> | undefined;
          const candidate = candidates?.[0];
          const content = candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined;
          const parts = content?.parts ?? [];

          for (const part of parts) {
            if (typeof part.text === "string" && part.text.length > 0) {
              if (!part.thought) {
                yield { type: "text", delta: part.text };
              }
            }
            if (part.functionCall && typeof part.functionCall === "object") {
              const fc = part.functionCall as Record<string, unknown>;
              const fcName = fc.name as string | undefined;
              const fcArgs = (fc.args as Record<string, unknown>) ?? {};

              // Extract thoughtSignature if present anywhere in part, fc, or candidate
              const sig =
                (part.thoughtSignature as string | undefined) ||
                (part.thought_signature as string | undefined) ||
                (fc.thoughtSignature as string | undefined) ||
                (fc.thought_signature as string | undefined) ||
                (candidate?.thoughtSignature as string | undefined) ||
                (candidate?.thought_signature as string | undefined);

              if (fcName) {
                yield {
                  type: "tool_call",
                  call: {
                    id: `gemini_${crypto.randomBytes(4).toString("hex")}`,
                    name: fcName,
                    args: fcArgs,
                    thoughtSignature: sig,
                  },
                };
              }
            }
          }
        }
      }

      yield { type: "done" };
    },
  };
}
