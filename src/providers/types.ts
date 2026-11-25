import type { ProviderConfig, ProviderId } from "../types.js";

export interface ToolParameterSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }
  >;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

export type LLMMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

export type LLMStreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "done" };

export interface LLMChatParams {
  systemPrompt: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  streamChat(params: LLMChatParams): AsyncGenerator<LLMStreamEvent>;
}

export type ProviderConstructor = (cfg: ProviderConfig) => LLMProvider;
