import type { OroStore } from "../db/store.js";
import type { LLMProvider } from "../providers/types.js";
import type { SessionRecord } from "../types.js";
import type { VaultFsManager } from "../vault/fs-manager.js";

export interface DistillationResult {
  summary: string;
  memoriesAdded: number;
  tasksAdded: number;
  notePath: string;
}

interface ParsedDistillation {
  title?: string;
  summary?: string;
  memories?: Array<{
    content: string;
    category?: "fact" | "preference" | "decision" | "project" | "summary";
    importance?: number;
    tags?: string[];
  }>;
  tasks?: string[];
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "session"
  );
}

export async function summarizeAndDistillSession(opts: {
  session: SessionRecord;
  provider: LLMProvider;
  store: OroStore;
  fsManager: VaultFsManager;
  signal?: AbortSignal;
}): Promise<DistillationResult> {
  const messages = opts.store.getMessages(opts.session.id, 60);
  const sessionFiles = opts.store.getSessionFiles(opts.session.id);

  if (messages.length === 0) {
    throw new Error("Current session has no messages to summarize yet.");
  }

  const transcript = messages
    .map((m) =>
      m.role === "tool"
        ? `[TOOL ${m.toolName}]: ${m.content}`
        : `${m.role.toUpperCase()}: ${m.content.slice(0, 1200)}`
    )
    .join("\n\n");

  const fileList = sessionFiles
    .map((f) => `- ${f.path} (${f.lastAction}${f.pinned ? ", pinned" : ""})`)
    .join("\n");

  const prompt = [
    "Distill the following Second Brain session into JSON ONLY (no markdown fences).",
    "Return an object with shape:",
    `{`,
    `  "title": "Short 3-6 word session title",`,
    `  "summary": "2-4 sentence executive summary of what was discussed and accomplished",`,
    `  "memories": [{ "content": "durable fact/decision/preference", "category": "decision|fact|preference|project", "importance": 3, "tags": ["tag"] }],`,
    `  "tasks": ["actionable next step"]`,
    `}`,
    "",
    "Session files touched:",
    fileList || "(none)",
    "",
    "Transcript:",
    transcript.slice(-14000),
  ].join("\n");

  let rawResponse = "";
  for await (const evt of opts.provider.streamChat({
    systemPrompt: "You are a precise knowledge distiller. Output strictly valid JSON with no extra text.",
    messages: [{ role: "user", content: prompt }],
    tools: [],
    signal: opts.signal,
  })) {
    if (evt.type === "text") rawResponse += evt.delta;
  }

  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  let parsed: ParsedDistillation = {};
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]) as ParsedDistillation;
    } catch {
      parsed = { summary: rawResponse.trim() };
    }
  } else {
    parsed = { summary: rawResponse.trim() };
  }

  const title = parsed.title?.trim() || opts.session.title;
  const summary = parsed.summary?.trim() || "Session distilled.";

  opts.store.updateSession(opts.session.id, { title, summary });

  let memoriesAdded = 0;
  for (const m of parsed.memories ?? []) {
    if (!m.content?.trim()) continue;
    opts.store.saveMemory({
      content: m.content.trim(),
      category: m.category ?? "fact",
      importance: m.importance ?? 3,
      tags: m.tags ?? [],
      sourceSessionId: opts.session.id,
    });
    memoriesAdded++;
  }

  let tasksAdded = 0;
  for (const t of parsed.tasks ?? []) {
    if (!t?.trim()) continue;
    opts.store.addTask({ title: t.trim(), sessionId: opts.session.id });
    tasksAdded++;
  }

  // Write a linked Second Brain Markdown session note
  const dateStr = new Date().toISOString().slice(0, 10);
  const notePath = `Sessions/${dateStr}-${slugify(title)}.md`;

  const linkedFiles = sessionFiles
    .filter((f) => f.lastAction !== "deleted")
    .map((f) => {
      const target = f.path.replace(/\.md$/i, "");
      return `- [[${target}]] (${f.lastAction}${f.pinned ? ", pinned" : ""})`;
    });

  const mdLines = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `date: ${dateStr}`,
    `session_id: ${opts.session.id}`,
    `tags: [session, oro]`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Summary",
    summary,
    "",
  ];

  if (linkedFiles.length > 0) {
    mdLines.push("## Files Worked On", ...linkedFiles, "");
  }

  if ((parsed.memories ?? []).length > 0) {
    mdLines.push(
      "## Extracted Memories",
      ...(parsed.memories ?? []).map((m) => `- **(${m.category ?? "fact"})** ${m.content}`),
      ""
    );
  }

  if ((parsed.tasks ?? []).length > 0) {
    mdLines.push(
      "## Next Actions",
      ...(parsed.tasks ?? []).map((t) => `- [ ] ${t}`),
      ""
    );
  }

  opts.fsManager.writeFile(notePath, mdLines.join("\n"), opts.session.id);

  return { summary, memoriesAdded, tasksAdded, notePath };
}
