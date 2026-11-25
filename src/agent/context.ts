import path from "node:path";
import type { OroStore } from "../db/store.js";
import type { AgentModeId, SessionRecord, TreeNode } from "../types.js";
import type { VaultFsManager } from "../vault/fs-manager.js";
import { AGENT_MODES } from "./modes.js";

function summarizeTree(nodes: TreeNode[], depth = 0, maxItems = 16, acc: string[] = []): string[] {
  for (const n of nodes) {
    if (acc.length >= maxItems) {
      acc.push("... (more files; use list_files to explore)");
      break;
    }
    const pad = "  ".repeat(depth);
    acc.push(`${pad}${n.isDir ? n.name + "/" : n.name}`);
    if (n.children && n.children.length > 0 && depth < 2) {
      summarizeTree(n.children, depth + 1, maxItems, acc);
    }
  }
  return acc;
}

export const TOKEN_EFFICIENCY_DIRECTIVES = [
  "## Token Efficiency & Output Quality Directives",
  "- **Zero Fluff & Direct Start**: Never start responses with conversational pleasantries, affirmations, or preambles ('Sure!', 'Certainly!', 'I would be happy to help', 'Understood', 'Here is the result'). Start immediately with the answer, analysis, plan, or tool call.",
  "- **Action-First Execution**: When the user requests an action (create, edit, delete, move, test, organize), call the appropriate tool immediately in step 1 without preliminary explanation.",
  "- **Micro-Diffs over Rewrites**: When modifying existing code or notes, always use `edit_file` with the smallest possible unambiguous target block (3-8 lines). Never rewrite an entire 200+ line file with `write_file` for a localized change.",
  "- **Targeted Reading**: When inspecting large files, use `startLine` and `endLine` parameters in `read_file` to read only relevant sections instead of fetching entire files.",
  "- **High-Density Markdown**: Format information using bullet points, tables, and Obsidian [[wiki-links]]. Avoid repeating the user's prompt or restating what has already been established.",
  "- **Decisive Completion**: When your tools have executed successfully, summarize the exact files or changes in 1-3 lines and conclude. Never add unprompted rhetorical questions or filler at the end.",
].join("\n");

export function buildSystemPrompt(opts: {
  mode: AgentModeId;
  session: SessionRecord;
  store: OroStore;
  fsManager: VaultFsManager;
  latestUserPrompt: string;
  userInstructions?: string;
}): string {
  const modeSpec = AGENT_MODES[opts.mode];
  const stats = opts.store.getVaultStats();
  const sessionFiles = opts.store.getSessionFiles(opts.session.id);
  const pinnedFiles = sessionFiles.filter((f) => f.pinned);
  const touchedFiles = sessionFiles.slice(0, 6);

  const treeLines = summarizeTree(opts.fsManager.buildTree("", 2));

  // Recall relevant memories: prioritize query-matched memories to keep prompt compact and relevant
  const queryMemories = opts.latestUserPrompt.trim()
    ? opts.store.searchMemories(opts.latestUserPrompt, 3)
    : [];
  const topMemories = queryMemories.length < 3 ? opts.store.listMemories(3 - queryMemories.length) : [];
  const memMap = new Map<number, typeof topMemories[0]>();
  for (const m of queryMemories) memMap.set(m.id, m);
  for (const m of topMemories) memMap.set(m.id, m);
  const memories = Array.from(memMap.values()).slice(0, 4);

  const openTasks = opts.store.listTasks(false, 4);

  const sections: string[] = [];

  if (opts.userInstructions?.trim()) {
    sections.push(`## User Instructions & Preferences\n${opts.userInstructions.trim()}\n`);
  }

  sections.push(
    TOKEN_EFFICIENCY_DIRECTIVES,
    "",
    modeSpec.instructions,
    "",
    `## Workspace Context`,
    `- Workspace: ${path.basename(opts.fsManager.workspaceRoot)}`,
    `- Active Session: "${opts.session.title}" (Mode: ${modeSpec.label})`,
    `- Vault Index: ${stats.notes} notes, ${stats.links} links (${stats.brokenLinks} unresolved), ${stats.memories} memories, ${stats.openTasks} open tasks`,
    `- Date: ${new Date().toISOString().slice(0, 10)}`
  );

  if (treeLines.length > 0) {
    sections.push("", "### Structure (top-level)", "```", ...treeLines, "```");
  }

  if (touchedFiles.length > 0) {
    sections.push(
      "",
      "### Recent Session Files",
      ...touchedFiles.map((f) => `- ${f.pinned ? "[PINNED] " : ""}${f.path}`)
    );
  }

  // Inject contents of pinned files (compact budget: up to ~3.5 KB total)
  if (pinnedFiles.length > 0) {
    let budget = 3500;
    sections.push("", "### Pinned Context");
    for (const pf of pinnedFiles) {
      if (budget <= 0) break;
      try {
        const read = opts.fsManager.readFile(pf.path, undefined, { track: false });
        const snippet = read.content.slice(0, Math.min(1800, budget));
        budget -= snippet.length;
        sections.push(`\n#### ${pf.path}\n\`\`\`\n${snippet}\n\`\`\``);
      } catch {
        sections.push(`- ${pf.path}`);
      }
    }
  }

  if (memories.length > 0) {
    sections.push(
      "",
      "### Relevant Second Brain Memories",
      ...memories.map(
        (m) => `- [★${m.importance}] ${m.content}${m.tags.length ? ` (#${m.tags.join(" #")})` : ""}`
      )
    );
  }

  if (openTasks.length > 0) {
    sections.push(
      "",
      "### Active Tasks",
      ...openTasks.map((t) => `- [ ] ${t.title}${t.filePath ? ` (${t.filePath})` : ""}`)
    );
  }

  return sections.join("\n");
}
