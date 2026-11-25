import fs from "node:fs";
import path from "node:path";
import { OroStore } from "../dist/db/store.js";
import { VaultIndexer } from "../dist/vault/indexer.js";

const VAULTS = [
  "C:/Users/BACH/OroBrain",
  path.resolve("my-brain")
];

const DUMMY_FILES = {
  "Notes/Welcome.md": `---
title: "Welcome to Oro"
date: "2026-11-19"
tags: [oro, second-brain, moc, start]
---

# Welcome to Oro ✦

Oro is your **All-in-One Second Brain & Autonomous AI Workspace**. It bridges active agent sessions with an interconnected Obsidian-compatible knowledge graph.

## 🗺️ Knowledge Map (MOC)
Click any \`[[wiki-link]]\` below to navigate directly into that note in the editor:

- [[AI Architecture]] — Local SQLite FTS5, streaming SSE, and agent loop
- [[Product Strategy]] — Product vision, user experience pillars, and roadmap
- [[Projects/Roadmap]] — Development milestones, deliverables, and targets
- [[Weekly Review]] — Active tasks, weekly reflections, and action items
- [[Reading List]] — Summaries of books, AI research papers, and technical essays
- [[Inbox/Quick Capture]] — Unprocessed ideas ready for Oro's **Organizer** mode

## ⚡ Interactive Features to Test
1. **Click \`[[wiki-links]]\`**: Click any link above or in text to jump across notes.
2. **Backlinks Explorer**: Look at the bottom of the editor pane to see all incoming and outgoing connections.
3. **Split Preview**: Click the \`<Columns />\` icon in the editor toolbar to view Monaco code side-by-side with rendered markdown.
4. **Instant Search**: Click the **Search** tab in the sidebar and search for \`"neural"\`, \`"sqlite"\`, or \`"strategy"\`.
5. **Brain Checklist**: Click the **Brain** tab in the sidebar to view all \`- [ ]\` tasks aggregated across all notes!
`,

  "Notes/AI Architecture.md": `---
title: "AI Architecture & Engine"
date: "2026-11-19"
tags: [ai, architecture, sqlite, fts5, agent]
---

# AI Architecture & Engine

Oro combines a host **Node.js 26** engine with **SQLite FTS5** and multi-provider streaming LLM agents.

Connected to: [[Welcome]], [[Product Strategy]], and [[Projects/Roadmap]].

## System Overview
The backend server runs seamlessly on localhost port \`5824\` with high-speed REST and SSE streaming:
- **Host Engine**: Direct \`node:sqlite\` with WAL mode for zero-latency queries.
- **FTS5 Indexer**: Automatic incremental file watcher indexing on save.
- **Decoupled Desktop**: Native Windows GUI window with transparent titlebar.

## Agent Tool Execution Pipeline
The agent operates in four distinct modes:
1. **Assistant**: Conversational helper and thought partner.
2. **Organizer**: Cleans up tags, restructures folders, and links orphan notes.
3. **Researcher**: Deep dives into multi-file synthesis and knowledge retrieval.
4. **Builder**: Writes code, modifies files, and manages projects.

## Python Agent Router Example
\`\`\`python
# Projects/Code/agent.py
class OroAgent:
    def __init__(self, provider: str = "gemini-2.5-flash"):
        self.provider = provider
        self.tools = ["read_file", "write_file", "search_vault", "save_memory"]

    def execute_turn(self, prompt: str):
        print(f"Executing turn with provider {self.provider}...")
        return {"status": "success", "tools_used": len(self.tools)}
\`\`\`

## Active Architecture Tasks
- [x] Integrate node:sqlite DatabaseSync with FTS5 virtual tables
- [x] Build decoupled desktop window shell with zero native compilation
- [ ] Implement local vector embeddings using ONNX Runtime
- [ ] Add streaming tool call visualization chips
`,

  "Notes/Product Strategy.md": `---
title: "Product Strategy & Vision"
date: "2026-11-19"
tags: [strategy, product, design, vision]
---

# Product Strategy & Vision

Our goal is to build the highest-performance, calmest personal AI workspace on the desktop.

Connected to: [[Welcome]], [[AI Architecture]], and [[Weekly Review]].

## Core Pillars
| Pillar | Philosophy | Implementation |
|---|---|---|
| **Local-First** | You own all your data in plain text markdown & SQLite | No proprietary lock-in, Obsidian-compatible |
| **Calm Aesthetics** | High-contrast black & white, Open Sans typography | Zero distracting colors, seamless floating cards |
| **Direct Manipulation** | Instant file editing right in the session | Embedded Monaco editor with split live preview |
| **Fluid AI** | AI that acts upon your files, not just chats | 4 Agent Modes, session file tracking, auto-summarization |

## Key Decisions
- Adopted unified body layout with floating island prompt box.
- Standardized on \`[[wiki-links]]\` with automatic refactoring on file rename.
- Linked to [[Reading List]] for cognitive science and second brain methodologies.
`,

  "Notes/Weekly Review.md": `---
title: "Weekly Review & Active Tasks"
date: "2026-11-19"
tags: [review, tasks, planning, personal]
---

# Weekly Review & Active Tasks

Connected to: [[Welcome]], [[Projects/Roadmap]], and [[Product Strategy]].

## Highlights This Week
- Successfully resolved Electron main process decoupling.
- Created standalone native Windows desktop launcher: \`Oro.exe\`.
- Applied minimalist monochrome black & white theme with Open Sans.
- Built comprehensive multi-tab Settings menu with AI provider configuration.

## Active Action Items
- [x] Compile native desktop .exe launcher with zero console popup
- [x] Implement unified body canvas with floating chat box
- [x] Configure Open Sans typography and JetBrains Mono code font
- [ ] Benchmark local Ollama Llama 3.2 inference speed vs Gemini 2.5 Flash
- [ ] Add keyboard shortcut cheat sheet overlay
- [ ] Verify bidirectional graph links in [[AI Architecture]]
`,

  "Notes/Reading List.md": `---
title: "Reading List & Research Notes"
date: "2026-11-19"
tags: [books, research, papers, learning]
---

# Reading List & Research Notes

Connected to: [[Welcome]] and [[Product Strategy]].

## Books
### *Building a Second Brain* by Tiago Forte
- **CODE Framework**: Capture, Organize, Distill, Express.
- **PARA Method**: Projects, Areas, Resources, Archives.
- *Key Takeaway*: Treat your Second Brain not as an archive of the past, but as a dynamic springboard for future action.

### *Crafting Interpreters* by Robert Nystrom
- AST traversal, bytecode VMs, and lexical scoping.
- Inspires Oro's markdown AST parser for \`[[wiki-links]]\` and task extraction.

## Research Papers
- **Attention Is All You Need** (Vaswani et al.) — Foundational transformer architecture powering modern LLMs.
- **Constitutional AI** (Anthropic) — Training AI assistants to be helpful, honest, and harmless.
`,

  "Projects/Roadmap.md": `---
title: "Oro Project Roadmap"
date: "2026-11-19"
tags: [projects, roadmap, milestones]
---

# Oro Project Roadmap

Connected to: [[Welcome]], [[AI Architecture]], and [[Weekly Review]].

## Milestone 1: The Core Foundation (Completed)
- [x] SQLite FTS5 note indexer and link resolution engine
- [x] Multi-provider AI streaming (Gemini, OpenAI, Claude, Ollama)
- [x] React 19 + Monaco editor with syntax highlighting and live split preview
- [x] Session files strip tracking files touched during AI turns

## Milestone 2: Desktop Experience (Completed)
- [x] Native Windows GUI executable launcher (Oro.exe)
- [x] Unified canvas body with floating rounded cards
- [x] Floating island chat prompt box with backdrop blur
- [x] Full Settings menu (AI providers, editor preferences, vault location)

## Milestone 3: Advanced Intelligence (Upcoming)
- [ ] Interactive 2D graph view visualizing note connections
- [ ] Hybrid search (BM25 FTS5 + local vector semantic search)
- [ ] Web search integration for Researcher mode
- [ ] Git versioning integration for notes and code
`,

  "Inbox/Quick Capture.md": `---
title: "Quick Capture"
date: "2026-11-19"
tags: [inbox, fleeting, capture]
---

# Quick Capture

Dump quick ideas, snippets, and fleeting thoughts here. Use Oro's **Organizer** mode to file and connect them into [[Welcome]] or [[Weekly Review]].

## Unsorted Thoughts
- Idea: Add a command palette (\`Ctrl+Shift+P\`) to quickly jump between open files and recent sessions.
- Research: Look into SQLite JSON functions for storing structured session tool call traces.
- Note: Need to verify that clicking \`[[Reading List]]\` from split preview works smoothly.
`,

  "Projects/Code/agent.py": `"""
Autonomous Agent Tool Router for Oro
"""
from typing import Dict, Any, List

class AgentToolRouter:
    def __init__(self, workspace_root: str):
        self.workspace_root = workspace_root
        self.call_history: List[Dict[str, Any]] = []

    def dispatch(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Dispatch a tool call to the local vault or file system."""
        print(f"[Tool] Invoking {tool_name} with {arguments}")
        result = {"success": True, "tool": tool_name, "args": arguments}
        self.call_history.append(result)
        return result

if __name__ == "__main__":
    router = AgentToolRouter("C:/Users/BACH/OroBrain")
    print(router.dispatch("search_vault", {"query": "neural"}))
`,

  "Projects/Code/types.ts": `/**
 * Core Knowledge Graph Types
 */
export interface NoteNode {
  path: string;
  title: string;
  tags: string[];
  links: string[];
  wordCount: number;
}

export interface SearchQuery {
  terms: string;
  limit: number;
  tags?: string[];
}
`,

  "Projects/Code/config.json": `{
  "appName": "Oro",
  "version": "0.2.0",
  "theme": "monochrome",
  "typography": {
    "primary": "Open Sans",
    "monospace": "JetBrains Mono"
  },
  "database": {
    "engine": "node:sqlite",
    "search": "fts5",
    "walMode": true
  }
}
`
};

for (const vaultDir of VAULTS) {
  console.log(`Populating vault at: ${vaultDir}`);
  fs.mkdirSync(vaultDir, { recursive: true });

  // Write all dummy files
  for (const [relPath, content] of Object.entries(DUMMY_FILES)) {
    const fullPath = path.join(vaultDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }

  // Open store and run indexer
  const oroDir = path.join(vaultDir, ".oro");
  fs.mkdirSync(oroDir, { recursive: true });
  const dbPath = path.join(oroDir, "oro.db");
  const store = new OroStore(dbPath);
  const indexer = new VaultIndexer(vaultDir, store);

  const stats = indexer.indexAll(true);
  console.log(`Indexed ${stats.total} notes in ${stats.durationMs}ms for ${vaultDir}`);

  // Populate persistent memories
  const memories = [
    { content: "User prefers a clean, high-contrast black & white minimalist theme", category: "preference", importance: 5 },
    { content: "Primary programming languages are TypeScript and Python", category: "fact", importance: 4 },
    { content: "Active project is the Oro AI Second Brain desktop workspace", category: "project", importance: 5 },
    { content: "Typography configured to Open Sans with JetBrains Mono for code", category: "preference", importance: 4 }
  ];

  for (const m of memories) {
    store.saveMemory(m);
  }

  // Populate sample tasks
  const sampleTasks = [
    { title: "Benchmark local Ollama Llama 3.2 inference speed vs Gemini", filePath: "Notes/Weekly Review.md" },
    { title: "Add keyboard shortcut cheat sheet overlay", filePath: "Notes/Weekly Review.md" },
    { title: "Verify bidirectional graph links in AI Architecture", filePath: "Notes/Weekly Review.md" },
    { title: "Implement local vector embeddings using ONNX Runtime", filePath: "Notes/AI Architecture.md" },
    { title: "Interactive 2D graph view visualizing note connections", filePath: "Projects/Roadmap.md" },
    { title: "Hybrid search BM25 FTS5 + local vector semantic search", filePath: "Projects/Roadmap.md" },
    { title: "Git versioning integration for notes and code", filePath: "Projects/Roadmap.md" },
  ];

  for (const t of sampleTasks) {
    store.addTask(t);
  }

  // Ensure default sessions
  const sessions = store.listSessions(10);
  if (sessions.length === 0) {
    const sess = store.createSession({
      title: "Main Workspace",
      mode: "assistant",
      provider: "gemini",
      model: "gemini-2.5-flash"
    });
    store.trackSessionFile(sess.id, "Notes/Welcome.md", "read", true);
    store.trackSessionFile(sess.id, "Projects/Roadmap.md", "read", true);
    store.trackSessionFile(sess.id, "Notes/AI Architecture.md", "modified", false);
  } else {
    store.trackSessionFile(sessions[0].id, "Notes/Welcome.md", "read", true);
    store.trackSessionFile(sessions[0].id, "Projects/Roadmap.md", "read", true);
    store.trackSessionFile(sessions[0].id, "Notes/AI Architecture.md", "modified", false);
  }

  const vaultStats = store.getVaultStats();
  console.log(`Vault stats for ${path.basename(vaultDir)}:`, vaultStats);
  store.close();
}

console.log("All dummy data, files, links, and persistent memories populated successfully!");
