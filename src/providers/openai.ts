import crypto from "node:crypto";
import type { ProviderConfig } from "../types.js";
import type { LLMChatParams, LLMMessage, LLMProvider, LLMStreamEvent, ToolDefinition } from "./types.js";

function toOpenAIMessages(systemPrompt: string, messages: LLMMessage[]) {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: systemPrompt }];
  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const m: Record<string, unknown> = {
        role: "assistant",
        content: msg.content || null,
      };
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        m.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          },
        }));
      }
      out.push(m);
    } else if (msg.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: msg.toolCallId,
        content: msg.content,
      });
    }
  }
  return out;
}

function toOpenAITools(tools: ToolDefinition[]) {
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

export function createOpenAIProvider(cfg: ProviderConfig): LLMProvider {
  const apiKey = cfg.apiKey?.trim();
  const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = cfg.model || "gpt-4o-mini";

  return {
    id: "openai",
    model,
    async *streamChat(params: LLMChatParams): AsyncGenerator<LLMStreamEvent> {
      if (!apiKey) {
        throw new Error(
          "OpenAI API key not configured. Run `/key openai <YOUR_API_KEY>` or set OPENAI_API_KEY."
        );
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: toOpenAIMessages(params.systemPrompt, params.messages),
          tools: toOpenAITools(params.tools),
          stream: true,
          ...(model.startsWith("o") || model.includes("reasoning")
            ? { reasoning_effort: cfg.reasoningEffort || "medium" }
            : {}),
        }),
        signal: params.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`OpenAI API error (${res.status}): ${errText.slice(0, 300)}`);
      }
      if (!res.body) {
        throw new Error("OpenAI API returned empty stream body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const pendingTools = new Map<number, { id: string; name: string; argsBuf: string }>();

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

          const choices = json.choices as Array<Record<string, unknown>> | undefined;
          const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          if (typeof delta.content === "string" && delta.content.length > 0) {
            yield { type: "text", delta: delta.content };
          }

          const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (toolCalls) {
            for (const tc of toolCalls) {
              const idx = Number(tc.index ?? 0);
              const existing = pendingTools.get(idx) ?? {
                id: String(tc.id || `oai_${crypto.randomBytes(4).toString("hex")}`),
                name: "",
                argsBuf: "",
              };
              if (tc.id) existing.id = String(tc.id);
              const fn = tc.function as { name?: string; arguments?: string } | undefined;
              if (fn?.name) existing.name += fn.name;
              if (fn?.arguments) existing.argsBuf += fn.arguments;
              pendingTools.set(idx, existing);
            }
          }
        }
      }

      for (const tc of pendingTools.values()) {
        if (!tc.name) continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.argsBuf || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        yield {
          type: "tool_call",
          call: { id: tc.id, name: tc.name, args },
        };
      }

      yield { type: "done" };
    },
  };
}
