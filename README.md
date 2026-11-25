# ✦ Oro — AI Agents Desktop App & Second Brain Workspace

Oro is a native, cross-platform desktop application built with **Tauri v2 (Rust)**, **React 19**, **Vite**, **Monaco Editor**, and **SQLite FTS5**. It combines a multi-provider AI agent workspace, a live multi-tab code & markdown editor, and an Obsidian-compatible Second Brain in a fast, lightweight native binary.

---

## Key Features

### AI Agent Workspace
- **Multi-Provider Streaming & Tool Calling**: Native Rust streaming client supporting **Google Gemini**, **OpenAI** (and OpenAI-compatible endpoints), **Anthropic Claude**, and local **Ollama**.
- **Built-in Agent Tools**: Read/write files, search workspace content, execute terminal commands silently (no popup windows), and generate images (`generate_image`).
- **Multimodal Chat**: Paste screenshots directly with `Ctrl+V` or drag-and-drop files and folders into the chat or sidebar.
- **Session Management**: Per-workspace isolated chat sessions, full tool-action history persistence, one-click **Copy**, and **Undo to this point** rollback under chat turns.

### Live Editor & Second Brain
- **Multi-Tab Monaco Editor**: Syntax highlighting, dirty indicators, `Ctrl+S` saving, and **Editor / Split / Preview / Diff** modes.
- **Obsidian-Compatible Vault**: Interactive `[[wiki-links]]`, automatic outgoing links & backlinks, and instant **SQLite FTS5** full-text search.
- **Workspace Switcher**: Switch between recent workspaces or create a new workspace inline; remembers your last workspace across restarts.
- **Collapsible File Explorer (`Ctrl+B`)**: Nested folder tree with drag-and-drop import, inline file/folder creation, and instant deletion.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop Shell & Backend | Rust, Tauri v2, Tokio, Reqwest |
| Database & Search | SQLite (`rusqlite`) + FTS5 |
| Frontend | React 19, TypeScript, Vite 8 |
| Editor & Rendering | Monaco Editor, Marked, Lucide Icons, Three.js |

---

## Prerequisites

- **Node.js** `>= 22.5.0`
- **Rust** (stable toolchain via [rustup](https://rustup.rs/))
- **Tauri v2 system prerequisites** (e.g., WebView2 + Visual Studio C++ Build Tools on Windows; see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/))

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode
```bash
npm run dev
```

### 3. Typecheck & Run Tests
```bash
npm run typecheck
npm test
```

### 4. Build Release Binary
```bash
# Builds the frontend and compiles the standalone native binary (no installer bundle)
npm run tauri:release

# Or build full OS installers (.msi / .exe / .dmg / .AppImage)
npm run tauri:build
```

On Windows, the standalone release executable is output to:
```
src-tauri/target/release/app.exe
```

---

## Configuration & Local Data

Oro stores user configuration and chat history **outside** the repository so API keys and personal data are never committed:

- **App Config & API Keys**: `~/.oro/config.json`
- **SQLite Database**:
  - Windows: `%APPDATA%\com.oro.desktop\oro_coworker.db`
  - macOS: `~/Library/Application Support/com.oro.desktop/oro_coworker.db`
  - Linux: `~/.local/share/com.oro.desktop/oro_coworker.db`

---

## Project Structure

```text
oro/
├── src/
│   └── renderer/          # React UI, components, API bridge, styles
├── src-tauri/
│   ├── src/
│   │   ├── agent/         # LLM providers, orchestrator, tool implementations
│   │   ├── commands.rs    # Tauri IPC commands
│   │   ├── db.rs          # SQLite + FTS5 persistence
│   │   └── lib.rs         # Tauri app bootstrap
│   └── tauri.conf.json    # Tauri v2 configuration
├── tests/                 # Unit & integration tests
└── package.json
```
