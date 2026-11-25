import type { OroStore } from "../db/store.js";
import type { ToolDefinition, LLMProvider, LLMMessage, ToolCallRequest } from "../providers/types.js";
import type { TreeNode, OroConfig, SubagentProgressEvent } from "../types.js";
import type { VaultFsManager } from "../vault/fs-manager.js";
import { ToolLoopBreaker, executeWithTimeout } from "./circuit-breaker.js";

export { SubagentProgressEvent, ToolLoopBreaker, executeWithTimeout };

export interface ToolRuntime {
  store: OroStore;
  fsManager: VaultFsManager;
  sessionId: string;
  onVaultMutated?: () => void;
  provider?: LLMProvider;
  config?: OroConfig;
  signal?: AbortSignal;
  onSubagentProgress?: (event: SubagentProgressEvent) => void;
  loopBreaker?: ToolLoopBreaker;
  timeoutMs?: number;
}

export interface ToolExecutionResult {
  ok: boolean;
  output: string;
  summary: string;
}

export const ORO_TOOLS: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and folders inside the workspace or a subdirectory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative folder path (empty or '.' for workspace root)" },
        maxDepth: { type: "number", description: "Max recursion depth (default 3)" },
      },
    },
  },
  {
    name: "read_file",
    description: "Read the text content of a workspace file. Automatically tracks the file in the current session.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        startLine: { type: "number", description: "Optional 1-based start line" },
        endLine: { type: "number", description: "Optional 1-based end line" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create a new file or overwrite an existing file in the workspace. Auto-creates parent directories and indexes Markdown notes.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        content: { type: "string", description: "Full UTF-8 file content" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace an exact text block inside an existing workspace file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        target: { type: "string", description: "Exact existing text to replace" },
        replacement: { type: "string", description: "Replacement text" },
      },
      required: ["path", "target", "replacement"],
    },
  },
  {
    name: "create_folder",
    description: "Create a folder (and any missing parent folders) in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative folder path" },
      },
      required: ["path"],
    },
  },
  {
    name: "move_path",
    description: "Move or rename a file or folder. When moving a Markdown note, automatically updates incoming [[wiki-links]] across the vault.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Current relative path" },
        to: { type: "string", description: "Destination relative path" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "delete_path",
    description: "Safely delete a file or folder by moving it to .oro/trash/ for recovery.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file or folder path" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_vault",
    description: "Full-text FTS5 search across all indexed Markdown/text notes in the workspace.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords" },
        limit: { type: "number", description: "Max hits (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_backlinks",
    description: "Get outgoing [[wiki-links]], incoming backlinks, and #tags for a Markdown note.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative note path" },
      },
      required: ["path"],
    },
  },
  {
    name: "pin_file",
    description: "Pin or unpin a file into the current session's active context so it remains visible across turns.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        pinned: { type: "boolean", description: "true to pin, false to unpin (default true)" },
      },
      required: ["path"],
    },
  },
  {
    name: "memory_save",
    description: "Save a durable fact, preference, decision, or project insight into persistent Second Brain memory across sessions.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Concise memory statement to remember" },
        category: {
          type: "string",
          description: "Memory category",
          enum: ["fact", "preference", "decision", "project", "summary"],
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for organizing the memory",
        },
        importance: { type: "number", description: "Importance 1 (low) to 5 (critical), default 3" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_search",
    description: "Search persistent Second Brain memories across all past sessions.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (or empty string to list top memories)" },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "task_add",
    description: "Add an action item / task to the Second Brain task list.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task description" },
        filePath: { type: "string", description: "Optional related workspace file path" },
      },
      required: ["title"],
    },
  },
  {
    name: "task_list",
    description: "List tasks from the Second Brain task list.",
    parameters: {
      type: "object",
      properties: {
        includeDone: { type: "boolean", description: "Whether to include completed tasks (default false)" },
      },
    },
  },
  {
    name: "task_toggle",
    description: "Mark a task as completed or incomplete by its numeric ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Task numeric ID" },
        done: { type: "boolean", description: "Optional explicit completion state" },
      },
      required: ["id"],
    },
  },
  {
    name: "spawn_subagent",
    description: "Spawn a specialized autonomous subagent (e.g., 'researcher', 'architect', 'coder', 'critic', 'writer') to independently investigate notes, formulate designs, execute code edits, or verify solutions, and report back its findings.",
    parameters: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: "Descriptive role title (e.g. 'Research Scout', 'Component Architect', 'Test Verifier', 'Documentation Writer')",
        },
        task: {
          type: "string",
          description: "Clear actionable objective and detailed instructions for the subagent",
        },
        modelTier: {
          type: "string",
          enum: ["fast", "standard", "reasoning"],
          description: "Model tier: 'fast' (lightweight flash-lite for rapid search/scanning), 'standard' (flash/4o for general execution), 'reasoning' (pro/o3 for complex logic)",
        },
      },
      required: ["role", "task"],
    },
  },
];

export const ORCHESTRATOR_TOOLS: ToolDefinition[] = ORO_TOOLS.filter((t) =>
  ["spawn_subagent", "task_add", "task_list", "task_toggle", "memory_save", "memory_search", "read_file"].includes(t.name)
);

export const PLANNER_TOOLS: ToolDefinition[] = ORO_TOOLS.filter((t) =>
  ["list_files", "read_file", "search_vault", "get_backlinks", "memory_search"].includes(t.name)
);

export const BUILDER_TOOLS: ToolDefinition[] = ORO_TOOLS.filter((t) =>
  ["read_file", "write_file", "edit_file", "create_folder", "move_path"].includes(t.name)
);

export const DEBUGGER_TOOLS: ToolDefinition[] = ORO_TOOLS.filter((t) =>
  ["read_file", "edit_file", "search_vault"].includes(t.name)
);

export const LIBRARIAN_TOOLS: ToolDefinition[] = ORO_TOOLS.filter((t) =>
  ["search_vault", "get_backlinks", "memory_save", "memory_search", "task_add"].includes(t.name)
);

export function getToolsForRole(role: string): ToolDefinition[] {
  const r = role.toLowerCase();
  if (r.includes("plan") || r.includes("scout") || r.includes("architect") || r.includes("research")) {
    return PLANNER_TOOLS;
  }
  if (r.includes("build") || r.includes("code") || r.includes("write") || r.includes("execut") || r.includes("optimi") || r.includes("refin")) {
    return BUILDER_TOOLS;
  }
  if (r.includes("debug") || r.includes("verif") || r.includes("test") || r.includes("critic") || r.includes("improv") || r.includes("heal") || r.includes("fix")) {
    return DEBUGGER_TOOLS;
  }
  if (r.includes("librar") || r.includes("curat") || r.includes("organ")) {
    return LIBRARIAN_TOOLS;
  }
  return BUILDER_TOOLS;
}

function formatTree(nodes: TreeNode[], indent = ""): string[] {
  const lines: string[] = [];
  for (const n of nodes) {
    lines.push(`${indent}${n.isDir ? "📁 " + n.name + "/" : "📄 " + n.name}`);
    if (n.children && n.children.length > 0) {
      lines.push(...formatTree(n.children, indent + "  "));
    }
  }
  return lines;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  rt: ToolRuntime
): Promise<ToolExecutionResult> {
  if (rt.loopBreaker) {
    const status = rt.loopBreaker.record(name, args);
    if (!status.allowed) {
      return {
        ok: false,
        output: status.reason || `Circuit breaker: Tool "${name}" looped with identical arguments.`,
        summary: `Loop breaker: ${name} (${status.repetitions}x)`,
      };
    }
  }

  return executeWithTimeout(
    async (timeoutSignal) => {
      const activeSignal = timeoutSignal || rt.signal;
      try {
        switch (name) {
      case "list_files": {
        const subPath = typeof args.path === "string" ? args.path : "";
        const maxDepth = typeof args.maxDepth === "number" ? Math.min(6, Math.max(1, args.maxDepth)) : 2;
        const tree = rt.fsManager.buildTree(subPath, maxDepth);
        const lines = formatTree(tree);
        const text = lines.length > 0 ? lines.join("\n") : "(empty directory)";
        return {
          ok: true,
          output: `Directory: ${subPath || "."} (${lines.length} items):\n${text}`,
          summary: `Listed ${lines.length} items in ${subPath || "."}`,
        };
      }

      case "read_file": {
        const p = String(args.path ?? "");
        const startLine = typeof args.startLine === "number" ? args.startLine : undefined;
        const endLine = typeof args.endLine === "number" ? args.endLine : undefined;
        const res = rt.fsManager.readFile(p, rt.sessionId, { startLine, endLine });
        const maxChars = 8000;
        const truncated = res.content.length > maxChars;
        const body = truncated
          ? res.content.slice(0, maxChars) + `\n...[truncated; total ${res.totalLines} lines. Use startLine/endLine to view more]`
          : res.content;
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: `File: ${res.path} (${res.totalLines} lines):\n\`\`\`\n${body}\n\`\`\``,
          summary: `Read ${res.path} (${res.totalLines} lines)`,
        };
      }

      case "write_file": {
        const p = String(args.path ?? "");
        const content = String(args.content ?? "");
        const res = rt.fsManager.writeFile(p, content, rt.sessionId);
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: `Successfully ${res.action === "created" ? "created" : "updated"} ${res.path} (${res.bytes} bytes).`,
          summary: `${res.action === "created" ? "Created" : "Updated"} ${res.path} (${res.bytes} B)`,
        };
      }

      case "edit_file": {
        const p = String(args.path ?? "");
        const target = String(args.target ?? "");
        const replacement = String(args.replacement ?? "");
        const res = rt.fsManager.editFile(p, target, replacement, rt.sessionId);
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: `Successfully edited ${res.path}: replaced ${res.replacements} occurrence(s).`,
          summary: `Edited ${res.path} (${res.replacements} change${res.replacements === 1 ? "" : "s"})`,
        };
      }

      case "create_folder": {
        const p = String(args.path ?? "");
        const res = rt.fsManager.createFolder(p, rt.sessionId);
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: res.created ? `Created directory: ${res.path}/` : `Directory already exists: ${res.path}/`,
          summary: `${res.created ? "Created folder" : "Folder exists"} ${res.path}/`,
        };
      }

      case "move_path": {
        const from = String(args.from ?? "");
        const to = String(args.to ?? "");
        const res = rt.fsManager.movePath(from, to, rt.sessionId);
        rt.onVaultMutated?.();
        const linkNote =
          res.updatedLinksIn.length > 0 ? ` (refactored links in ${res.updatedLinksIn.length} notes)` : "";
        return {
          ok: true,
          output: `Moved ${res.from} → ${res.to}${linkNote}`,
          summary: `Moved ${res.from} → ${res.to}${linkNote}`,
        };
      }

      case "delete_path": {
        const p = String(args.path ?? "");
        const res = rt.fsManager.deletePath(p, rt.sessionId);
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: `Moved ${res.path} to trash (.oro/trash).`,
          summary: `Moved ${res.path} to trash`,
        };
      }

      case "search_vault": {
        const query = String(args.query ?? "");
        const limit = typeof args.limit === "number" ? Math.min(args.limit, 8) : 6;
        const hits = rt.store.searchNotes(query, limit);
        const formatted = hits.map((h, i) => `${i + 1}. [[${h.title}]] (${h.path}): ${h.snippet.replace(/\n+/g, " ").slice(0, 160)}`).join("\n");
        return {
          ok: true,
          output: hits.length > 0 ? `Found ${hits.length} note(s) for "${query}":\n${formatted}` : `No notes found matching "${query}".`,
          summary: `Vault search "${query}" → ${hits.length} hit${hits.length === 1 ? "" : "s"}`,
        };
      }

      case "get_backlinks": {
        const p = String(args.path ?? "").replace(/\\/g, "/");
        const outgoing = rt.store.getOutgoingLinks(p);
        const backlinks = rt.store.getBacklinks(p);
        const tags = rt.store.getTagsForNote(p);
        const parts: string[] = [`Note: ${p}`];
        if (tags.length > 0) parts.push(`Tags: #${tags.join(" #")}`);
        parts.push(`Backlinks (${backlinks.length}): ${backlinks.length ? backlinks.map((b) => `[[${b.sourceTitle || b.sourcePath}]]`).join(", ") : "(none)"}`);
        parts.push(`Outgoing (${outgoing.length}): ${outgoing.length ? outgoing.map((o) => `[[${o.targetResolved || o.targetRaw}]]`).join(", ") : "(none)"}`);
        return {
          ok: true,
          output: parts.join("\n"),
          summary: `Links for ${p}: ${outgoing.length} out, ${backlinks.length} in`,
        };
      }

      case "pin_file": {
        const p = String(args.path ?? "");
        const pinned = args.pinned === undefined ? true : Boolean(args.pinned);
        const { rel } = rt.fsManager.resolveSafe(p);
        rt.store.setFilePinned(rt.sessionId, rel, pinned);
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: pinned ? `Pinned "${rel}" in active session context.` : `Unpinned "${rel}".`,
          summary: `${pinned ? "Pinned" : "Unpinned"} ${rel}`,
        };
      }

      case "memory_save": {
        const content = String(args.content ?? "");
        const category = (typeof args.category === "string" ? args.category : "fact") as
          | "fact"
          | "preference"
          | "decision"
          | "project"
          | "summary";
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
        const importance = typeof args.importance === "number" ? args.importance : 3;
        const mem = rt.store.saveMemory({
          content,
          category,
          tags,
          importance,
          sourceSessionId: rt.sessionId,
        });
        rt.onVaultMutated?.();
        const tagStr = tags.length > 0 ? ` (#${tags.join(" #")})` : "";
        return {
          ok: true,
          output: `Saved memory #${mem.id} [★${importance}|${category}]: "${content}"${tagStr}`,
          summary: `Saved memory #${mem.id} [${mem.category}]`,
        };
      }

      case "memory_search": {
        const query = String(args.query ?? "");
        const limit = typeof args.limit === "number" ? args.limit : 8;
        const memories = rt.store.searchMemories(query, limit);
        if (memories.length === 0) {
          return {
            ok: true,
            output: `No memories found matching "${query}".`,
            summary: `Memory search "${query}" → 0 hits`,
          };
        }
        const lines = memories.map(
          (m) => `- #${m.id} [★${m.importance}|${m.category}] ${m.content}${m.tags.length ? ` (#${m.tags.join(" #")})` : ""}`
        );
        return {
          ok: true,
          output: `Found ${memories.length} memory/memories for "${query}":\n${lines.join("\n")}`,
          summary: `Memory search "${query}" → ${memories.length} hit${memories.length === 1 ? "" : "s"}`,
        };
      }

      case "task_add": {
        const title = String(args.title ?? "");
        const filePath = typeof args.filePath === "string" ? args.filePath : null;
        const task = rt.store.addTask({ title, filePath, sessionId: rt.sessionId });
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: `Added task #${task.id}: [ ] ${task.title}${task.filePath ? ` (${task.filePath})` : ""}`,
          summary: `Added task #${task.id}: ${task.title}`,
        };
      }

      case "task_list": {
        const includeDone = Boolean(args.includeDone);
        const tasks = rt.store.listTasks(includeDone, 30);
        if (tasks.length === 0) {
          return {
            ok: true,
            output: includeDone ? "No tasks found in Second Brain." : "No open tasks in Second Brain.",
            summary: `0 tasks`,
          };
        }
        const lines = tasks.map(
          (t) => `- [${t.done ? "x" : " "}] #${t.id} ${t.title}${t.filePath ? ` (${t.filePath})` : ""}`
        );
        return {
          ok: true,
          output: `Tasks (${tasks.length} total):\n${lines.join("\n")}`,
          summary: `Listed ${tasks.length} task${tasks.length === 1 ? "" : "s"}`,
        };
      }

      case "task_toggle": {
        const id = Number(args.id);
        const done = typeof args.done === "boolean" ? args.done : undefined;
        const task = rt.store.toggleTask(id, done);
        if (!task) {
          return { ok: false, output: `Error: Task #${id} not found.`, summary: `Task #${id} not found` };
        }
        rt.onVaultMutated?.();
        return {
          ok: true,
          output: `Task #${task.id} marked ${task.done ? "completed [x]" : "open [ ]"}: "${task.title}".`,
          summary: `Task #${task.id} marked ${task.done ? "done" : "open"}`,
        };
      }

      case "spawn_subagent": {
        const role = String(args.role ?? "Subagent");
        const task = String(args.task ?? "");
        const modelTier = (args.modelTier as "fast" | "standard" | "reasoning") || "standard";
        const subagentId = `subagent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        rt.onSubagentProgress?.({
          id: subagentId,
          role,
          task,
          modelTier,
          status: "running",
        });

        // 1. Gather relevant context for this subagent (file list, memories)
        const tree = rt.fsManager.buildTree("", 2);
        const fileNames = formatTree(tree).slice(0, 30).join("\n");
        const relevantMemories = rt.store.searchMemories(task).slice(0, 5);
        const memContext = relevantMemories.map((m) => `- ${m.content}`).join("\n");

        const subTools = getToolsForRole(role);
        let findings = "";
        let summary = "";

        if (rt.provider) {
          const subagentSystemPrompt = [
            `You are a specialized autonomous subagent in Oro Second Brain.`,
            `Role: ${role}`,
            `Assigned Objective: ${task}`,
            `Model Tier: ${modelTier}`,
            ``,
            `Workspace Files Overview:`,
            fileNames,
            memContext ? `\nRelevant Second Brain Context:\n${memContext}` : ``,
            ``,
            `Guidelines:`,
            `- Use your provided tools to read, edit, or search as required to fulfill your objective.`,
            `- Apply micro-diff edits with edit_file rather than rewriting whole files.`,
            `- Be concise, precise, and highly actionable.`,
            `- Conclude with a clear synthesis of what you inspected, created, or resolved.`,
          ].join("\n");

          try {
            const subMessages: LLMMessage[] = [{ role: "user", content: `Execute assigned task: ${task}` }];
            let subSteps = 0;
            const maxSubSteps = 4;

            while (subSteps < maxSubSteps) {
              subSteps++;
              if (activeSignal?.aborted) break;

              let stepText = "";
              const stepToolCalls: ToolCallRequest[] = [];

              for await (const chunk of rt.provider.streamChat({
                systemPrompt: subagentSystemPrompt,
                messages: subMessages,
                tools: subTools,
                signal: activeSignal,
              })) {
                if (chunk.type === "text") {
                  stepText += chunk.delta;
                } else if (chunk.type === "tool_call") {
                  stepToolCalls.push(chunk.call);
                }
              }

              if (stepToolCalls.length === 0) {
                if (stepText) findings = stepText.trim();
                break;
              }

              subMessages.push({
                role: "assistant",
                content: stepText,
                toolCalls: stepToolCalls,
              });

              for (const tc of stepToolCalls) {
                // Prevent recursive spawning
                if (tc.name === "spawn_subagent") {
                  subMessages.push({
                    role: "tool",
                    toolCallId: tc.id,
                    toolName: tc.name,
                    content: "Recursive subagent spawning is prohibited.",
                  });
                  continue;
                }

                const subRes = await executeTool(tc.name, tc.args, {
                  ...rt,
                  // Disable nested subagent emission to keep UI events clean
                  onSubagentProgress: undefined,
                });

                subMessages.push({
                  role: "tool",
                  toolCallId: tc.id,
                  toolName: tc.name,
                  content: subRes.output,
                });
              }
            }

            if (!findings) {
              findings = subMessages
                .filter((m) => m.role === "assistant" && m.content)
                .map((m) => m.content)
                .pop() || `${role} completed assigned task.`;
            }
            summary = `${role} completed: ${findings.slice(0, 85).replace(/\n/g, " ")}...`;
          } catch (err: unknown) {
            const errStr = err instanceof Error ? err.message : String(err);
            findings = `Error executing subagent: ${errStr}`;
            summary = `Failed: ${errStr}`;
          }
        } else {
          // Offline / heuristic fallback
          const searchHits = rt.store.searchNotes(task).slice(0, 3);
          findings =
            searchHits.length > 0
              ? `Scouted ${searchHits.length} relevant notes:\n` +
                searchHits.map((h) => `- ${h.title} (${h.path}): ${h.snippet}`).join("\n")
              : `Explored workspace structure:\n${fileNames.slice(0, 200)}...`;
          summary = `${role} scanned ${searchHits.length} notes and workspace tree.`;
        }

        // Save finding to Second Brain memory for persistence
        try {
          rt.store.saveMemory({
            category: "project",
            content: `[Subagent: ${role}] Task: ${task} -> Result: ${findings.slice(0, 300)}`,
            tags: ["subagent", role.toLowerCase().replace(/\s+/g, "-")],
            importance: 3,
            sourceSessionId: rt.sessionId,
          });
        } catch {}

        rt.onSubagentProgress?.({
          id: subagentId,
          role,
          task,
          modelTier,
          status: "done",
          summary,
          findings,
        });

        return {
          ok: true,
          output: `[Subagent "${role}" Completed]\nRole: ${role}\nTask: ${task}\n\nFindings:\n${findings}`,
          summary: `Subagent "${role}" completed (${modelTier})`,
        };
      }

      default:
        return {
          ok: false,
          output: JSON.stringify({ error: `Unknown tool: ${name}` }),
          summary: `Unknown tool ${name}`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      output: JSON.stringify({ error: message }),
      summary: `${name} failed: ${message}`,
    };
  }
    },
    { timeoutMs: rt.timeoutMs ?? 15_000, signal: rt.signal, toolName: name }
  );
}
