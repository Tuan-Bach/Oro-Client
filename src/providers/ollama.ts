import crypto from "node:crypto";
import type { ProviderConfig } from "../types.js";
import type { LLMChatParams, LLMMessage, LLMProvider, LLMStreamEvent, ToolDefinition } from "./types.js";

function toOllamaMessages(systemPrompt: string, messages: LLMMessage[]) {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }];
  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const m: Record<string, unknown> = { role: "assistant", content: msg.content || "" };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args },
        }));
      }
      out.push(m);
    } else if (msg.role === "tool") {
      out.push({ role: "tool", content: msg.content });
    }
  }
  return out;
}

function toOllamaTools(tools: ToolDefinition[]) {
  if (tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function createOllamaProvider(cfg: ProviderConfig): LLMProvider {
  const baseUrl = (cfg.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
  const model = cfg.model || "llama3.2";

  return {
    id: "ollama",
    model,
    async *streamChat(params: LLMChatParams): AsyncGenerator<LLMStreamEvent> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: toOllamaMessages(params.systemPrompt, params.messages),
            tools: toOllamaTools(params.tools),
            stream: true,
          }),
          signal: params.signal,
        });
      } catch (err) {
        throw new Error(
          `Could not connect to Ollama at ${baseUrl}. Make sure Ollama is running (\`ollama serve\`). (${err instanceof Error ? err.message : String(err)})`
        );
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Ollama API error (${res.status}): ${errText.slice(0, 300)}`);
      }
      if (!res.body) {
        throw new Error("Ollama returned empty stream body");
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
          if (!line) continue;

          let json: Record<string, unknown>;
          try {
            json = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }

          const message = json.message as Record<string, unknown> | undefined;
          if (typeof message?.content === "string" && message.content.length > 0) {
            yield { type: "text", delta: message.content };
          }
          const toolCalls = message?.tool_calls as Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }> | undefined;
          if (toolCalls) {
            for (const tc of toolCalls) {
              if (tc.function?.name) {
                yield {
                  type: "tool_call",
                  call: {
                    id: `oll_${crypto.randomBytes(4).toString("hex")}`,
                    name: tc.function.name,
                    args: tc.function.arguments ?? {},
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
