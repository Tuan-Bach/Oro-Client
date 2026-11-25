import fs from "node:fs";
import path from "node:path";

/**
 * Initializes a rich Obsidian-compatible Second Brain starter structure
 * (Inbox, Notes, Projects, Sessions, Code) if the target directory is empty or new.
 */
export function initStarterVault(rootDir: string): void {
  const dirs = ["Inbox", "Notes", "Projects", "Projects/Code", "Sessions"];
  for (const d of dirs) {
    fs.mkdirSync(path.join(rootDir, d), { recursive: true });
  }

  const welcomePath = path.join(rootDir, "Notes", "Welcome.md");
  if (!fs.existsSync(welcomePath)) {
    fs.writeFileSync(
      welcomePath,
      `---
title: "Welcome to Oro"
date: "${new Date().toISOString().slice(0, 10)}"
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
      "utf8"
    );
  }

  const archPath = path.join(rootDir, "Notes", "AI Architecture.md");
  if (!fs.existsSync(archPath)) {
    fs.writeFileSync(
      archPath,
      `---
title: "AI Architecture & Engine"
date: "${new Date().toISOString().slice(0, 10)}"
tags: [ai, architecture, sqlite, fts5, agent]
---

# AI Architecture & Engine

Oro combines a host **Node.js 26** engine with **SQLite FTS5** and multi-provider streaming LLM agents.

Connected to: [[Welcome]], [[Product Strategy]], and [[Projects/Roadmap]].

## System Overview
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
    def __init__(self, provider: str = "gemini-3.8-flash"):
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
      "utf8"
    );
  }

  const stratPath = path.join(rootDir, "Notes", "Product Strategy.md");
  if (!fs.existsSync(stratPath)) {
    fs.writeFileSync(
      stratPath,
      `---
title: "Product Strategy & Vision"
date: "${new Date().toISOString().slice(0, 10)}"
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
`,
      "utf8"
    );
  }

  const reviewPath = path.join(rootDir, "Notes", "Weekly Review.md");
  if (!fs.existsSync(reviewPath)) {
    fs.writeFileSync(
      reviewPath,
      `---
title: "Weekly Review & Active Tasks"
date: "${new Date().toISOString().slice(0, 10)}"
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
      "utf8"
    );
  }

  const roadmapPath = path.join(rootDir, "Projects", "Roadmap.md");
  if (!fs.existsSync(roadmapPath)) {
    fs.writeFileSync(
      roadmapPath,
      `---
title: "Oro Project Roadmap"
date: "${new Date().toISOString().slice(0, 10)}"
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
      "utf8"
    );
  }

  const capturePath = path.join(rootDir, "Inbox", "Quick Capture.md");
  if (!fs.existsSync(capturePath)) {
    fs.writeFileSync(
      capturePath,
      `---
title: "Quick Capture"
date: "${new Date().toISOString().slice(0, 10)}"
tags: [inbox, fleeting, capture]
---

# Quick Capture

Dump quick ideas, snippets, and fleeting thoughts here. Use Oro's **Organizer** mode to file and connect them into [[Welcome]] or [[Weekly Review]].

## Unsorted Thoughts
- Idea: Add a command palette (\`Ctrl+Shift+P\`) to quickly jump between open files and recent sessions.
- Research: Look into SQLite JSON functions for storing structured session tool call traces.
- Note: Need to verify that clicking \`[[Reading List]]\` from split preview works smoothly.
`,
      "utf8"
    );
  }

  const agentCodePath = path.join(rootDir, "Projects", "Code", "agent.py");
  if (!fs.existsSync(agentCodePath)) {
    fs.writeFileSync(
      agentCodePath,
      `"""
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
      "utf8"
    );
  }
}
