import type { OroStore } from "../db/store.js";
import type { LLMMessage, LLMProvider, ToolCallRequest } from "../providers/types.js";
import type { AgentModeId, SessionRecord, ToolCallEvent, SubagentProgressEvent } from "../types.js";
import type { VaultFsManager } from "../vault/fs-manager.js";
import { buildSystemPrompt } from "./context.js";
import { classifyIntent } from "./modes.js";
import { executeTool, ORO_TOOLS, ToolLoopBreaker } from "./tools.js";
import { runAutonomousOrchestrator } from "./orchestrator.js";

export interface AgentRunCallbacks {
  onTextDelta?: (delta: string) => void;
  onToolEvent?: (event: ToolCallEvent) => void;
  onVaultMutated?: () => void;
  onModeDecided?: (effectiveMode: "plan" | "builder" | "triad") => void;
  onSubagentProgress?: (event: SubagentProgressEvent) => void;
}

export interface AgentRunResult {
  finalText: string;
  toolEvents: ToolCallEvent[];
  steps: number;
  decidedMode?: "plan" | "builder" | "triad";
}

function compactHistoricalMessage(content: string): string {
  if (content.length < 900) return content;
  // Compact excessively large code blocks in previous turns to save tokens
  return content.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const lines = code.split("\n");
    if (lines.length > 16) {
      const head = lines.slice(0, 8).join("\n");
      const tail = lines.slice(-4).join("\n");
      return `\`\`\`${lang}\n${head}\n// ... [${lines.length - 12} lines omitted from history to save tokens] ...\n${tail}\n\`\`\``;
    }
    return _match;
  });
}

function pruneIntermediateToolOutputs(messages: LLMMessage[]): void {
  // Find index of the latest assistant message in the current turn
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx <= 1) return;

  // Tool results prior to the latest assistant turn were already inspected and acted on.
  // Compact older large tool results (>900 chars) so subsequent steps don't re-transmit thousands of redundant tokens.
  for (let i = 0; i < lastAssistantIdx; i++) {
    const m = messages[i];
    if (m.role === "tool" && m.content.length > 900) {
      const lines = m.content.split("\n");
      if (lines.length > 16) {
        const head = lines.slice(0, 8).join("\n");
        const tail = lines.slice(-4).join("\n");
        m.content = `${head}\n... [${lines.length - 12} lines from earlier step compacted to save tokens] ...\n${tail}`;
      }
    }
  }
}

export async function runAgentTurn(opts: {
  userInput: string;
  session: SessionRecord;
  mode?: AgentModeId;
  provider: LLMProvider;
  store: OroStore;
  fsManager: VaultFsManager;
  maxSteps?: number;
  userInstructions?: string;
  signal?: AbortSignal;
  callbacks?: AgentRunCallbacks;
}): Promise<AgentRunResult> {
  opts.callbacks?.onModeDecided?.("builder");
  return runAutonomousOrchestrator({
    userInput: opts.userInput,
    session: opts.session,
    provider: opts.provider,
    store: opts.store,
    fsManager: opts.fsManager,
    maxSteps: opts.maxSteps,
    userInstructions: opts.userInstructions,
    signal: opts.signal,
    callbacks: opts.callbacks,
  });
}

export async function runLegacyAgentTurn(opts: {
  userInput: string;
  session: SessionRecord;
  mode: AgentModeId;
  provider: LLMProvider;
  store: OroStore;
  fsManager: VaultFsManager;
  maxSteps?: number;
  userInstructions?: string;
  signal?: AbortSignal;
  callbacks?: AgentRunCallbacks;
}): Promise<AgentRunResult> {
  const maxSteps = opts.maxSteps ?? 12;

  // Resolve mode: if Default, AI automatically decides between Plan and Builder based on user input
  const rawMode = opts.mode || "default";
  const classified = classifyIntent(opts.userInput);
  const effectiveMode: "plan" | "builder" =
    (rawMode === "default" || rawMode === "auto")
      ? (classified === "plan" ? "plan" : "builder")
      : rawMode === "builder"
      ? "builder"
      : "plan";

  opts.callbacks?.onModeDecided?.(effectiveMode);

  // Build history from persisted session messages using smart windowing (last 14 messages)
  const historyRows = opts.store.getMessages(opts.session.id, 14);
  const llmMessages: LLMMessage[] = [];
  for (let i = 0; i < historyRows.length; i++) {
    const row = historyRows[i];
    const isRecent = i >= historyRows.length - 2;
    if (row.role === "user") {
      llmMessages.push({
        role: "user",
        content: isRecent ? row.content : compactHistoricalMessage(row.content),
      });
    } else if (row.role === "assistant" && row.content.trim()) {
      llmMessages.push({
        role: "assistant",
        content: isRecent ? row.content : compactHistoricalMessage(row.content),
      });
    }
  }

  // Persist user message
  opts.store.addMessage({
    sessionId: opts.session.id,
    role: "user",
    content: opts.userInput,
  });
  llmMessages.push({ role: "user", content: opts.userInput });

  const allToolEvents: ToolCallEvent[] = [];
  let fullAssistantText = "";
  let steps = 0;
  const loopBreaker = new ToolLoopBreaker();

  // Cached system prompt: only recompute when vault state changes
  let systemPromptDirty = true;
  let cachedSystemPrompt = "";
  const getSystemPrompt = () => {
    if (systemPromptDirty) {
      cachedSystemPrompt = buildSystemPrompt({
        mode: effectiveMode,
        session: opts.session,
        store: opts.store,
        fsManager: opts.fsManager,
        latestUserPrompt: opts.userInput,
        userInstructions: opts.userInstructions,
      });
      systemPromptDirty = false;
    }
    return cachedSystemPrompt;
  };

  while (steps < maxSteps) {
    steps++;
    if (opts.signal?.aborted) break;

    // Prune earlier large tool outputs within the same turn to save tokens across steps
    pruneIntermediateToolOutputs(llmMessages);

    const systemPrompt = getSystemPrompt();

    let stepText = "";
    const stepToolCalls: ToolCallRequest[] = [];

    for await (const event of opts.provider.streamChat({
      systemPrompt,
      messages: llmMessages,
      tools: ORO_TOOLS,
      signal: opts.signal,
    })) {
      if (event.type === "text") {
        stepText += event.delta;
        fullAssistantText += event.delta;
        opts.callbacks?.onTextDelta?.(event.delta);
      } else if (event.type === "tool_call") {
        stepToolCalls.push(event.call);
      }
    }

    if (stepToolCalls.length === 0) {
      break;
    }

    // Record assistant's turn including tool calls
    llmMessages.push({
      role: "assistant",
      content: stepText,
      toolCalls: stepToolCalls,
    });

    if (stepText && !stepText.endsWith("\n")) {
      fullAssistantText += "\n";
      opts.callbacks?.onTextDelta?.("\n");
    }

    for (const tc of stepToolCalls) {
      const runningEvt: ToolCallEvent = {
        id: tc.id,
        name: tc.name,
        args: tc.args,
        status: "running",
      };
      allToolEvents.push(runningEvt);
      opts.callbacks?.onToolEvent?.({ ...runningEvt });

      const result = await executeTool(tc.name, tc.args, {
        store: opts.store,
        fsManager: opts.fsManager,
        sessionId: opts.session.id,
        provider: opts.provider,
        signal: opts.signal,
        loopBreaker,
        onSubagentProgress: opts.callbacks?.onSubagentProgress,
        onVaultMutated: () => {
          systemPromptDirty = true;
          opts.callbacks?.onVaultMutated?.();
        },
      });

      runningEvt.status = result.ok ? "done" : "error";
      runningEvt.summary = result.summary;
      opts.callbacks?.onToolEvent?.({ ...runningEvt });

      opts.store.addMessage({
        sessionId: opts.session.id,
        role: "tool",
        content: result.summary,
        toolName: tc.name,
        toolCallId: tc.id,
        toolArgs: JSON.stringify(tc.args),
      });

      llmMessages.push({
        role: "tool",
        toolCallId: tc.id,
        toolName: tc.name,
        content: result.output,
      });
    }
  }

  const finalText = fullAssistantText.trim() || "(completed)";
  opts.store.addMessage({
    sessionId: opts.session.id,
    role: "assistant",
    content: finalText,
  });

  return { finalText, toolEvents: allToolEvents, steps, decidedMode: effectiveMode };
}
