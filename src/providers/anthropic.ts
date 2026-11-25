import crypto from "node:crypto";
import type { ProviderConfig } from "../types.js";
import type { LLMChatParams, LLMMessage, LLMProvider, LLMStreamEvent, ToolDefinition } from "./types.js";

function toAnthropicMessages(messages: LLMMessage[]) {
  const out: Array<{ role: "user" | "assistant"; content: unknown[] }> = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: msg.content }] });
    } else if (msg.role === "assistant") {
      const blocks: unknown[] = [];
      if (msg.content) blocks.push({ type: "text", text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }
      }
      if (blocks.length > 0) {
        out.push({ role: "assistant", content: blocks });
      }
    } else if (msg.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.content,
      };
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.role === "user" &&
        prev.content.every((b) => typeof b === "object" && b !== null && (b as { type?: string }).type === "tool_result")
      ) {
        prev.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }

  return out;
}

function toAnthropicTools(tools: ToolDefinition[]) {
  if (tools.length === 0) return undefined;
  return tools.map((t, idx) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
    ...(idx === tools.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
  }));
}

export function createAnthropicProvider(cfg: ProviderConfig): LLMProvider {
  const apiKey = cfg.apiKey?.trim();
  const baseUrl = (cfg.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const model = cfg.model || "claude-sonnet-4-20250514";

  return {
    id: "anthropic",
    model,
    async *streamChat(params: LLMChatParams): AsyncGenerator<LLMStreamEvent> {
      if (!apiKey) {
        throw new Error(
          "Anthropic API key not configured. Run `/key anthropic <YOUR_API_KEY>` or set ANTHROPIC_API_KEY."
        );
      }

      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: [
            {
              type: "text",
              text: params.systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: toAnthropicMessages(params.messages),
          tools: toAnthropicTools(params.tools),
          stream: true,
        }),
        signal: params.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Anthropic API error (${res.status}): ${errText.slice(0, 300)}`);
      }
      if (!res.body) {
        throw new Error("Anthropic API returned empty stream body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let activeTool: { id: string; name: string; inputBuf: string } | null = null;

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
          if (!payload) continue;

          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(payload) as Record<string, unknown>;
          } catch {
            continue;
          }

          const evtType = String(evt.type || "");
          if (evtType === "content_block_start") {
            const cb = evt.content_block as Record<string, unknown> | undefined;
            if (cb?.type === "tool_use") {
              activeTool = {
                id: String(cb.id || `ant_${crypto.randomBytes(4).toString("hex")}`),
                name: String(cb.name || ""),
                inputBuf: "",
              };
            }
          } else if (evtType === "content_block_delta") {
            const delta = evt.delta as Record<string, unknown> | undefined;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              yield { type: "text", delta: delta.text };
            } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string" && activeTool) {
              activeTool.inputBuf += delta.partial_json;
            }
          } else if (evtType === "content_block_stop" && activeTool) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(activeTool.inputBuf || "{}") as Record<string, unknown>;
            } catch {
              args = {};
            }
            if (activeTool.name) {
              yield {
                type: "tool_call",
                call: { id: activeTool.id, name: activeTool.name, args },
              };
            }
            activeTool = null;
          }
        }
      }

      yield { type: "done" };
    },
  };
}
