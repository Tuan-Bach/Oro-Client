use std::path::Path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::agent::provider::ToolDefinition;
use crate::agent::snapshot::{ActiveTurnContext, SnapshotManager};
use crate::db::CoworkerStore;
use crate::vault::fs::VaultFs;
use crate::vault::indexer::VaultIndexer;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolExecutionResult {
    pub ok: bool,
    pub output: String,
    pub summary: String,
}

pub fn get_agent_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "list_files".to_string(),
            description: "List files and folders inside the workspace or a subdirectory.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Relative folder path (empty or '.' for workspace root)" },
                    "maxDepth": { "type": "number", "description": "Max recursion depth (default 3)" }
                }
            }),
        },
        ToolDefinition {
            name: "read_file".to_string(),
            description: "Read the text content of a workspace file. Automatically tracks the file in the current session.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative file path" },
                    "startLine": { "type": "number", "description": "Optional 1-based start line" },
                    "endLine": { "type": "number", "description": "Optional 1-based end line" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "write_file".to_string(),
            description: "Create a new file or overwrite an existing file in the workspace. Auto-creates parent directories and indexes Markdown notes.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative file path" },
                    "content": { "type": "string", "description": "Full UTF-8 file content" }
                },
                "required": ["path", "content"]
            }),
        },
        ToolDefinition {
            name: "edit_file".to_string(),
            description: "Replace an exact target text block inside an existing workspace file with replacement text.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative file path" },
                    "target": { "type": "string", "description": "Exact existing text to replace" },
                    "replacement": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "target", "replacement"]
            }),
        },
        ToolDefinition {
            name: "create_folder".to_string(),
            description: "Create a folder (and any missing parent folders) in the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative folder path" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "move_path".to_string(),
            description: "Move or rename a file or folder. When moving a Markdown note, automatically refactors incoming [[wiki-links]] across the vault.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "from": { "type": "string", "description": "Current relative path" },
                    "to": { "type": "string", "description": "Destination relative path" }
                },
                "required": ["from", "to"]
            }),
        },
        ToolDefinition {
            name: "delete_path".to_string(),
            description: "Safely delete a file or folder by moving it to .trash for recovery.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative file or folder path" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "search_vault".to_string(),
            description: "Full-text FTS5 search across all indexed Markdown/text notes in the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search keywords" },
                    "limit": { "type": "number", "description": "Max hits (default 10)" }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "get_backlinks".to_string(),
            description: "Get outgoing [[wiki-links]], incoming backlinks, and #tags for a Markdown note.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Workspace-relative note path" }
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "memory_save".to_string(),
            description: "Save a durable fact, preference, decision, or project insight into persistent Second Brain memory across sessions.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "content": { "type": "string", "description": "Concise memory statement to remember" },
                    "category": {
                        "type": "string",
                        "description": "Memory category",
                        "enum": ["fact", "preference", "decision", "project", "summary"]
                    },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional tags for organizing the memory"
                    },
                    "importance": { "type": "number", "description": "Importance 1 (low) to 5 (critical), default 3" }
                },
                "required": ["content"]
            }),
        },
        ToolDefinition {
            name: "memory_search".to_string(),
            description: "Search persistent Second Brain memories across all past sessions.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query" },
                    "limit": { "type": "number", "description": "Max results (default 10)" }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "task_add".to_string(),
            description: "Add an action item / task to the Second Brain task list.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "Task description" },
                    "filePath": { "type": "string", "description": "Optional related workspace file path" }
                },
                "required": ["title"]
            }),
        },
        ToolDefinition {
            name: "task_list".to_string(),
            description: "List tasks from the Second Brain task list.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "includeDone": { "type": "boolean", "description": "Whether to include completed tasks (default false)" }
                }
            }),
        },
        ToolDefinition {
            name: "task_toggle".to_string(),
            description: "Mark a task as completed or incomplete by its numeric ID.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "number", "description": "Task numeric ID" },
                    "done": { "type": "boolean", "description": "Optional explicit completion state" }
                },
                "required": ["id"]
            }),
        },
        ToolDefinition {
            name: "execute_command".to_string(),
            description: "Execute a command in powershell/cmd within the workspace (e.g. tests, lint, git status).".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Command line string to execute" }
                },
                "required": ["command"]
            }),
        },
        ToolDefinition {
            name: "generate_image".to_string(),
            description: "Generate an image from a text prompt using Gemini Imagen/Flash-Image and save it into the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Detailed description of the image to generate" },
                    "output_path": { "type": "string", "description": "Relative path to save the PNG image (e.g. 'assets/diagram.png')" }
                },
                "required": ["prompt"]
            }),
        },
        ToolDefinition {
            name: "generate_video".to_string(),
            description: "Generate a short MP4 video from a text prompt using Gemini Veo (long-running operation) and save it into the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "Detailed visual description of the video to generate" },
                    "output_path": { "type": "string", "description": "Relative path to save the MP4 video (e.g. 'assets/demo.mp4')" },
                    "aspect_ratio": { "type": "string", "description": "Optional aspect ratio: '16:9' (default) or '9:16'" }
                },
                "required": ["prompt"]
            }),
        },
    ]
}

fn format_tree_items(
    nodes: &[crate::vault::fs::TreeNode],
    indent: usize,
    out: &mut String,
    total_files: &mut usize,
    total_dirs: &mut usize,
) {
    let pad = "  ".repeat(indent);
    for n in nodes {
        if n.node_type == "directory" {
            *total_dirs += 1;
            out.push_str(&format!("{}📁 {}/\n", pad, n.name));
            if let Some(ref children) = n.children
                && indent < 3 {
                    format_tree_items(children, indent + 1, out, total_files, total_dirs);
                }
        } else {
            *total_files += 1;
            out.push_str(&format!("{}📄 {}\n", pad, n.name));
        }
    }
}

pub struct ToolExecutor<'a> {
    pub workspace_root: &'a Path,
    pub store: &'a CoworkerStore,
    pub snapshot_manager: &'a SnapshotManager,
    pub session_id: &'a str,
}

impl<'a> ToolExecutor<'a> {
    pub fn new(
        workspace_root: &'a Path,
        store: &'a CoworkerStore,
        snapshot_manager: &'a SnapshotManager,
        session_id: &'a str,
    ) -> Self {
        Self {
            workspace_root,
            store,
            snapshot_manager,
            session_id,
        }
    }

    pub fn execute(
        &self,
        name: &str,
        args: &Value,
        turn_ctx: &mut ActiveTurnContext,
    ) -> ToolExecutionResult {
        match name {
            "list_files" => {
                let sub_path = args["path"].as_str().unwrap_or("");
                let tree_res = VaultFs::get_tree(self.workspace_root, if sub_path.is_empty() { None } else { Some(sub_path) });
                match tree_res {
                    Ok(tree) => {
                        let mut total_files = 0;
                        let mut total_dirs = 0;
                        let mut text = String::new();
                        format_tree_items(&tree, 0, &mut text, &mut total_files, &mut total_dirs);
                        let total = total_files + total_dirs;
                        let path_display = if sub_path.is_empty() { "." } else { sub_path };
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Directory '{}': {} folder(s), {} file(s)\n{}", path_display, total_dirs, total_files, text),
                            summary: format!("Listed {} items in '{}'", total, path_display),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to list files: {}", e),
                        summary: format!("Error listing files: {}", e),
                    },
                }
            }

            "read_file" => {
                let p = args["path"].as_str().unwrap_or("");
                if p.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Missing 'path' argument".to_string(),
                        summary: "Missing path".to_string(),
                    };
                }

                let read_res = VaultFs::read_file(self.workspace_root, p);
                match read_res {
                    Ok(res) => {
                        let _ = self.store.track_session_file(self.session_id, &res.path, "read");
                        let all_lines: Vec<&str> = res.content.lines().collect();
                        let total_lines = all_lines.len();

                        let start = args["startLine"].as_u64()
                            .or_else(|| args["start_line"].as_u64())
                            .map(|n| n as usize);
                        let end = args["endLine"].as_u64()
                            .or_else(|| args["end_line"].as_u64())
                            .map(|n| n as usize);

                        let (start_line, end_line, is_truncated) = match (start, end) {
                            (Some(s), Some(e)) => (s.max(1), e.min(total_lines).max(s), false),
                            (Some(s), None) => (s.max(1), (s + 200).min(total_lines), s + 200 < total_lines),
                            (None, Some(e)) => (1, e.min(total_lines), false),
                            (None, None) => {
                                if total_lines > 400 {
                                    (1, 250, true)
                                } else {
                                    (1, total_lines, false)
                                }
                            }
                        };

                        let start_idx = start_line.saturating_sub(1);
                        let end_idx = end_line.min(total_lines);

                        let mut formatted = String::new();
                        if total_lines == 0 {
                            formatted.push_str("   1 | (empty file)\n");
                        } else {
                            for (i, line) in all_lines[start_idx..end_idx].iter().enumerate() {
                                let line_num = start_line + i;
                                formatted.push_str(&format!("{:>4} | {}\n", line_num, line));
                            }
                        }

                        if is_truncated {
                            formatted.push_str(&format!("\n... [showing lines {}-{} of {}. Pass startLine: {} to read more]\n", start_line, end_line, total_lines, end_line + 1));
                        }

                        ToolExecutionResult {
                            ok: true,
                            output: format!("File: {} (lines {}-{} of {}):\n```\n{}```", res.path, start_line, end_line, total_lines, formatted),
                            summary: format!("Read {} (L{}-L{} of {})", res.path, start_line, end_line, total_lines),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to read file '{}': {}", p, e),
                        summary: format!("Error reading {}", p),
                    },
                }
            }

            "write_file" => {
                let p = args["path"].as_str().unwrap_or("");
                let content = args["content"].as_str().unwrap_or("");
                if p.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Missing 'path' argument".to_string(),
                        summary: "Missing path".to_string(),
                    };
                }

                let full = self.workspace_root.join(p);
                let action = if full.exists() { "modified" } else { "created" };

                // 1. Record pre-mutation snapshot BEFORE touching disk
                self.snapshot_manager.record_before_mutation(turn_ctx, p, action, None);

                // 2. Write file
                let write_res = VaultFs::write_file(self.workspace_root, p, content);
                match write_res {
                    Ok(res) => {
                        let _ = self.store.track_session_file(self.session_id, &res.path, action);

                        // If Markdown, update indexer
                        if p.ends_with(".md") || p.ends_with(".markdown") || p.ends_with(".txt") {
                            let parsed = crate::vault::parser::parse_markdown(p, content);
                            let fm_json = serde_json::to_string(&parsed.frontmatter).unwrap_or_else(|_| "{}".to_string());
                            let _ = self.store.upsert_note(
                                p,
                                &parsed.title,
                                content,
                                &fm_json,
                                chrono::Utc::now().timestamp_millis() as f64,
                                res.bytes,
                                parsed.word_count,
                                &parsed.links,
                                &parsed.tags,
                            );
                            let _ = self.store.resolve_all_links();
                        }

                        ToolExecutionResult {
                            ok: true,
                            output: format!("Successfully {} {} ({} bytes).", res.action, res.path, res.bytes),
                            summary: format!("{} {} ({} B)", if res.action == "created" { "Created" } else { "Updated" }, res.path, res.bytes),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to write file '{}': {}", p, e),
                        summary: format!("Error writing {}", p),
                    },
                }
            }

            "edit_file" => {
                let p = args["path"].as_str().unwrap_or("");
                let target = args["target"].as_str().unwrap_or("");
                let replacement = args["replacement"].as_str().unwrap_or("");

                if p.is_empty() || target.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Missing 'path' or 'target' argument".to_string(),
                        summary: "Missing arguments".to_string(),
                    };
                }

                let full = self.workspace_root.join(p);
                if !full.exists() {
                    return ToolExecutionResult {
                        ok: false,
                        output: format!("File does not exist: {}", p),
                        summary: format!("File not found: {}", p),
                    };
                }

                let existing = match std::fs::read_to_string(&full) {
                    Ok(c) => c,
                    Err(e) => return ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to read file: {}", e),
                        summary: format!("Read error: {}", p),
                    },
                };

                // Robust line ending normalization (CRLF / LF)
                let updated = if existing.contains(target) {
                    existing.replacen(target, replacement, 1)
                } else {
                    let norm_existing = existing.replace("\r\n", "\n");
                    let norm_target = target.replace("\r\n", "\n");
                    let norm_replacement = replacement.replace("\r\n", "\n");
                    if norm_existing.contains(&norm_target) {
                        let replaced = norm_existing.replacen(&norm_target, &norm_replacement, 1);
                        if existing.contains("\r\n") {
                            replaced.replace('\n', "\r\n")
                        } else {
                            replaced
                        }
                    } else {
                        return ToolExecutionResult {
                            ok: false,
                            output: format!("Target string not found in {}. Ensure lines and whitespace match.", p),
                            summary: format!("Target not found in {}", p),
                        };
                    }
                };

                // 1. Record pre-mutation snapshot
                self.snapshot_manager.record_before_mutation(turn_ctx, p, "modified", None);

                match std::fs::write(&full, &updated) {
                    Ok(_) => {
                        let _ = self.store.track_session_file(self.session_id, p, "modified");

                        if p.ends_with(".md") || p.ends_with(".markdown") || p.ends_with(".txt") {
                            let parsed = crate::vault::parser::parse_markdown(p, &updated);
                            let fm_json = serde_json::to_string(&parsed.frontmatter).unwrap_or_else(|_| "{}".to_string());
                            let _ = self.store.upsert_note(
                                p,
                                &parsed.title,
                                &updated,
                                &fm_json,
                                chrono::Utc::now().timestamp_millis() as f64,
                                updated.len(),
                                parsed.word_count,
                                &parsed.links,
                                &parsed.tags,
                            );
                            let _ = self.store.resolve_all_links();
                        }

                        let old_lines = target.lines().count().max(1);
                        let new_lines = replacement.lines().count().max(1);
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Successfully edited {}:\n- Replaced {} line(s) with {} line(s).", p, old_lines, new_lines),
                            summary: format!("Edited {} (-{} / +{} L)", p, old_lines, new_lines),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to write edited file: {}", e),
                        summary: format!("Write error: {}", p),
                    },
                }
            }

            "create_folder" => {
                let p = args["path"].as_str().unwrap_or("");
                match VaultFs::create_folder(self.workspace_root, p) {
                    Ok(_) => ToolExecutionResult {
                        ok: true,
                        output: format!("Created folder: {}", p),
                        summary: format!("Created folder: {}", p),
                    },
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to create folder: {}", e),
                        summary: format!("Error creating folder: {}", e),
                    },
                }
            }

            "move_path" => {
                let from = args["from"].as_str().unwrap_or("");
                let to = args["to"].as_str().unwrap_or("");

                // 1. Record pre-mutation snapshot
                self.snapshot_manager.record_before_mutation(turn_ctx, to, "moved", Some(from));

                match VaultFs::move_path(self.workspace_root, from, to) {
                    Ok(res) => {
                        let _ = VaultIndexer::index_all(self.workspace_root, self.store);
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Moved {} -> {} (updated links in {} notes)", res.from, res.to, res.updated_links_in.len()),
                            summary: format!("Moved {} -> {}", res.from, res.to),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to move path: {}", e),
                        summary: format!("Move error: {}", e),
                    },
                }
            }

            "delete_path" => {
                let p = args["path"].as_str().unwrap_or("");

                // 1. Record pre-mutation snapshot
                self.snapshot_manager.record_before_mutation(turn_ctx, p, "deleted", None);

                match VaultFs::delete_path(self.workspace_root, p) {
                    Ok(trash_path) => {
                        let _ = self.store.delete_note(p);
                        let _ = self.store.resolve_all_links();
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Deleted {} (moved to {})", p, trash_path),
                            summary: format!("Deleted {}", p),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to delete path: {}", e),
                        summary: format!("Delete error: {}", e),
                    },
                }
            }

            "search_vault" => {
                let query = args["query"].as_str().unwrap_or("");
                match self.store.search_vault(query) {
                    Ok(hits) => {
                        let count = hits.len();
                        if hits.is_empty() {
                            ToolExecutionResult {
                                ok: true,
                                output: format!("No notes found matching '{}'.", query),
                                summary: format!("Search '{}' (0 hits)", query),
                            }
                        } else {
                            let mut formatted = format!("Found {} note(s) matching '{}':\n", count, query);
                            for (i, h) in hits.iter().enumerate() {
                                formatted.push_str(&format!("{}. [[{}]] ({})\n   Snippet: \"{}\"\n", i + 1, h.path, h.title, h.snippet.trim()));
                            }
                            ToolExecutionResult {
                                ok: true,
                                output: formatted,
                                summary: format!("Search '{}' ({} hit{})", query, count, if count > 1 { "s" } else { "" }),
                            }
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Search failed: {}", e),
                        summary: format!("Search error: {}", e),
                    },
                }
            }

            "get_backlinks" => {
                let p = args["path"].as_str().unwrap_or("");
                match self.store.get_backlinks(p) {
                    Ok(res) => {
                        let out_json = serde_json::to_string_pretty(&res).unwrap_or_default();
                        ToolExecutionResult {
                            ok: true,
                            output: out_json,
                            summary: format!("Backlinks for {} ({} incoming)", p, res.backlinks.len()),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to get backlinks: {}", e),
                        summary: format!("Backlinks error: {}", e),
                    },
                }
            }

            "memory_save" => {
                let content = args["content"].as_str().unwrap_or("");
                let cat = args["category"].as_str();
                let imp = args["importance"].as_i64();
                let tags: Vec<String> = args["tags"]
                    .as_array()
                    .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                    .unwrap_or_default();

                match self.store.save_memory(content, cat, &tags, imp, Some(self.session_id)) {
                    Ok(mem) => ToolExecutionResult {
                        ok: true,
                        output: format!("Saved memory #{} [{}]: {}", mem.id, mem.category, mem.content),
                        summary: format!("Saved memory: {}", &mem.content[..mem.content.len().min(40)]),
                    },
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to save memory: {}", e),
                        summary: format!("Memory save error: {}", e),
                    },
                }
            }

            "memory_search" => {
                let query = args["query"].as_str().unwrap_or("");
                let limit = args["limit"].as_u64().map(|l| l as usize);
                match self.store.search_memories(query, limit) {
                    Ok(mems) => {
                        let out_json = serde_json::to_string_pretty(&mems).unwrap_or_default();
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Found {} memories for '{}':\n{}", mems.len(), query, out_json),
                            summary: format!("Memory search '{}' ({} hits)", query, mems.len()),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to search memories: {}", e),
                        summary: format!("Memory search error: {}", e),
                    },
                }
            }

            "task_add" => {
                let title = args["title"].as_str().unwrap_or("");
                let fp = args["filePath"].as_str();
                match self.store.add_task(title, fp, Some(self.session_id)) {
                    Ok(task) => ToolExecutionResult {
                        ok: true,
                        output: format!("Added task #{}: {}", task.id, task.title),
                        summary: format!("Added task: {}", task.title),
                    },
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to add task: {}", e),
                        summary: format!("Task error: {}", e),
                    },
                }
            }

            "task_list" => {
                let inc = args["includeDone"].as_bool().unwrap_or(false);
                match self.store.list_tasks_all() {
                    Ok(tasks) => {
                        let filtered: Vec<_> = tasks.into_iter().filter(|t| inc || !t.done).collect();
                        let count = filtered.len();
                        let json_str = serde_json::to_string_pretty(&filtered).unwrap_or_default();
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Found {} task(s):\n{}", count, json_str),
                            summary: format!("Listed {} task(s)", count),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to list tasks: {}", e),
                        summary: format!("Task list error: {}", e),
                    },
                }
            }

            "task_toggle" => {
                let id = args["id"].as_i64().unwrap_or(0);
                let done = args["done"].as_bool();
                match self.store.toggle_task(id, done) {
                    Ok(Some(task)) => ToolExecutionResult {
                        ok: true,
                        output: format!("Task #{} marked as {}", task.id, if task.done { "completed" } else { "pending" }),
                        summary: format!("Toggled task #{}", task.id),
                    },
                    Ok(None) => ToolExecutionResult {
                        ok: false,
                        output: format!("Task #{} not found", id),
                        summary: format!("Task #{} not found", id),
                    },
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Failed to toggle task #{}: {}", id, e),
                        summary: format!("Task toggle error: {}", e),
                    },
                }
            }

            "generate_image" => {
                let prompt = args["prompt"].as_str().unwrap_or("");
                if prompt.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Missing 'prompt' argument".to_string(),
                        summary: "Missing prompt".to_string(),
                    };
                }
                let default_name = format!("assets/generated_{}.png", chrono::Utc::now().timestamp());
                let out_rel = args["output_path"].as_str().unwrap_or(&default_name);
                let out_abs = match VaultFs::resolve_safe_path(self.workspace_root, out_rel) {
                    Ok(p) => p,
                    Err(e) => {
                        return ToolExecutionResult {
                            ok: false,
                            output: format!("Invalid output_path: {}", e),
                            summary: "Invalid path".to_string(),
                        };
                    }
                };
                if let Some(parent) = out_abs.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                // Read Gemini API key from ~/.oro/config.json
                let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".to_string());
                let cfg_path = std::path::PathBuf::from(home).join(".oro").join("config.json");
                let api_key = std::fs::read_to_string(&cfg_path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<Value>(&c).ok())
                    .and_then(|v| v["providers"]["gemini"]["apiKey"].as_str().map(|s| s.to_string()))
                    .or_else(|| std::env::var("GEMINI_API_KEY").ok())
                    .unwrap_or_default();

                if api_key.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Gemini API key not configured in ~/.oro/config.json".to_string(),
                        summary: "Missing API key".to_string(),
                    };
                }

                let prompt_owned = prompt.to_string();
                let res = std::thread::spawn(move || -> Result<Vec<u8>, String> {
                    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
                    rt.block_on(async move {
                        let url = format!(
                            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key={}",
                            api_key
                        );
                        let body = json!({
                            "contents": [{ "role": "user", "parts": [{ "text": prompt_owned }] }],
                            "generationConfig": { "responseModalities": ["IMAGE"] }
                        });
                        let client = reqwest::Client::new();
                        let resp = client.post(&url).json(&body).send().await.map_err(|e| e.to_string())?;
                        if !resp.status().is_success() {
                            let status = resp.status();
                            let err = resp.text().await.unwrap_or_default();
                            return Err(format!("Image API error ({}): {}", status, &err[..err.len().min(300)]));
                        }
                        let val: Value = resp.json().await.map_err(|e| e.to_string())?;
                        let b64 = val["candidates"][0]["content"]["parts"]
                            .as_array()
                            .and_then(|parts| parts.iter().find_map(|p| p["inlineData"]["data"].as_str()))
                            .ok_or_else(|| "No image data returned by Gemini".to_string())?;
                        // Inline base64 decode without external crate
                        let mut out = Vec::with_capacity(b64.len() * 3 / 4);
                        let mut buf: u32 = 0;
                        let mut bits: u8 = 0;
                        for &b in b64.as_bytes() {
                            let val = match b {
                                b'A'..=b'Z' => b - b'A',
                                b'a'..=b'z' => b - b'a' + 26,
                                b'0'..=b'9' => b - b'0' + 52,
                                b'+' => 62,
                                b'/' => 63,
                                b'=' | b'\n' | b'\r' | b' ' => continue,
                                _ => return Err("Invalid base64 character".to_string()),
                            };
                            buf = (buf << 6) | (val as u32);
                            bits += 6;
                            if bits >= 8 {
                                bits -= 8;
                                out.push(((buf >> bits) & 0xFF) as u8);
                            }
                        }
                        Ok(out)
                    })
                })
                .join()
                .map_err(|_| "Image generation thread panicked".to_string())
                .and_then(|r| r);

                match res {
                    Ok(bytes) => {
                        if let Err(e) = std::fs::write(&out_abs, &bytes) {
                            return ToolExecutionResult {
                                ok: false,
                                output: format!("Failed to save image: {}", e),
                                summary: "Save failed".to_string(),
                            };
                        }
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Successfully generated image at {} ({} bytes).", out_rel, bytes.len()),
                            summary: format!("Generated {}", out_rel),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: e,
                        summary: "Image generation failed".to_string(),
                    },
                }
            }
            "generate_video" => {
                let prompt = args["prompt"].as_str().unwrap_or("");
                if prompt.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Missing 'prompt' argument".to_string(),
                        summary: "Missing prompt".to_string(),
                    };
                }
                let out_rel = args["output_path"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("generated_video.mp4");
                let aspect_ratio = args["aspect_ratio"]
                    .as_str()
                    .filter(|s| *s == "16:9" || *s == "9:16")
                    .unwrap_or("16:9")
                    .to_string();

                let out_abs = match VaultFs::resolve_safe_path(self.workspace_root, out_rel) {
                    Ok(p) => p,
                    Err(e) => {
                        return ToolExecutionResult {
                            ok: false,
                            output: format!("Invalid output_path: {}", e),
                            summary: "Invalid path".to_string(),
                        };
                    }
                };
                if let Some(parent) = out_abs.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".to_string());
                let cfg_path = std::path::PathBuf::from(home).join(".oro").join("config.json");
                let cfg_json = std::fs::read_to_string(&cfg_path)
                    .ok()
                    .and_then(|c| serde_json::from_str::<Value>(&c).ok());
                let api_key = cfg_json
                    .as_ref()
                    .and_then(|v| v["providers"]["gemini"]["apiKey"].as_str().map(|s| s.to_string()))
                    .or_else(|| std::env::var("GEMINI_API_KEY").ok())
                    .unwrap_or_default();
                let video_model = cfg_json
                    .as_ref()
                    .and_then(|v| v["providers"]["gemini"]["videoModel"].as_str().map(|s| s.to_string()))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| "veo-3.1-generate-preview".to_string());

                if api_key.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Gemini API key not configured in ~/.oro/config.json".to_string(),
                        summary: "Missing API key".to_string(),
                    };
                }

                let prompt_owned = prompt.to_string();
                let res = std::thread::spawn(move || -> Result<Vec<u8>, String> {
                    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
                    rt.block_on(async move {
                        let start_url = format!(
                            "https://generativelanguage.googleapis.com/v1beta/models/{}:predictLongRunning?key={}",
                            video_model, api_key
                        );
                        let body = json!({
                            "instances": [{ "prompt": prompt_owned }],
                            "parameters": {
                                "sampleCount": 1,
                                "resolution": "720p",
                                "aspectRatio": aspect_ratio
                            }
                        });
                        let client = reqwest::Client::new();
                        let resp = client.post(&start_url).json(&body).send().await.map_err(|e| e.to_string())?;
                        if !resp.status().is_success() {
                            let status = resp.status();
                            let err = resp.text().await.unwrap_or_default();
                            return Err(format!("Video API error ({}): {}", status, &err[..err.len().min(300)]));
                        }
                        let start_val: Value = resp.json().await.map_err(|e| e.to_string())?;
                        let op_name = start_val["name"]
                            .as_str()
                            .ok_or_else(|| "Video API did not return an operation name".to_string())?
                            .to_string();

                        // Poll operation every 5s up to 180s
                        let poll_url = format!(
                            "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                            op_name.trim_start_matches('/'),
                            api_key
                        );
                        let mut completed_val: Option<Value> = None;
                        for _ in 0..36 {
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            let poll_resp = client.get(&poll_url).send().await.map_err(|e| e.to_string())?;
                            if !poll_resp.status().is_success() {
                                let status = poll_resp.status();
                                let err = poll_resp.text().await.unwrap_or_default();
                                return Err(format!("Video poll error ({}): {}", status, &err[..err.len().min(300)]));
                            }
                            let val: Value = poll_resp.json().await.map_err(|e| e.to_string())?;
                            if val["done"].as_bool().unwrap_or(false) {
                                if let Some(err_obj) = val.get("error") {
                                    return Err(format!("Video generation failed: {}", err_obj));
                                }
                                completed_val = Some(val);
                                break;
                            }
                        }

                        let done_val = completed_val
                            .ok_or_else(|| "Video generation timed out after 180 seconds".to_string())?;
                        let video_uri = done_val["response"]["generateVideoResponse"]["generatedSamples"][0]["video"]["uri"]
                            .as_str()
                            .ok_or_else(|| "No video URI returned by Veo".to_string())?;

                        let download_url = if video_uri.contains("key=") {
                            video_uri.to_string()
                        } else if video_uri.contains('?') {
                            format!("{}&key={}", video_uri, api_key)
                        } else {
                            format!("{}?key={}", video_uri, api_key)
                        };

                        let dl_resp = client.get(&download_url).send().await.map_err(|e| e.to_string())?;
                        if !dl_resp.status().is_success() {
                            let status = dl_resp.status();
                            return Err(format!("Failed to download generated video ({})", status));
                        }
                        let bytes = dl_resp.bytes().await.map_err(|e| e.to_string())?;
                        Ok(bytes.to_vec())
                    })
                })
                .join()
                .map_err(|_| "Video generation thread panicked".to_string())
                .and_then(|r| r);

                match res {
                    Ok(bytes) => {
                        if let Err(e) = std::fs::write(&out_abs, &bytes) {
                            return ToolExecutionResult {
                                ok: false,
                                output: format!("Failed to save video: {}", e),
                                summary: "Save failed".to_string(),
                            };
                        }
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Successfully generated video at {} ({} bytes).", out_rel, bytes.len()),
                            summary: format!("Generated {}", out_rel),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: e,
                        summary: "Video generation failed".to_string(),
                    },
                }
            }
            "execute_command" => {
                let cmd = args["command"].as_str().unwrap_or("");
                if cmd.is_empty() {
                    return ToolExecutionResult {
                        ok: false,
                        output: "Missing 'command' argument".to_string(),
                        summary: "Missing command".to_string(),
                    };
                }

                // Execute via powershell (hidden window on Windows)
                let mut command = std::process::Command::new("powershell");
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x08000000);
                }
                let output_res = command
                    .arg("-NoProfile")
                    .arg("-NonInteractive")
                    .arg("-WindowStyle")
                    .arg("Hidden")
                    .arg("-Command")
                    .arg(cmd)
                    .current_dir(self.workspace_root)
                    .output();

                match output_res {
                    Ok(out) => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        let stderr = String::from_utf8_lossy(&out.stderr);
                        let code = out.status.code().unwrap_or(-1);
                        let max_len = 5000;
                        let comb = format!("Exit code: {}\nSTDOUT:\n{}\nSTDERR:\n{}", code, stdout, stderr);
                        let truncated = if comb.len() > max_len {
                            format!("{}\n...[truncated]", &comb[..max_len])
                        } else {
                            comb
                        };

                        ToolExecutionResult {
                            ok: out.status.success(),
                            output: truncated,
                            summary: format!("Executed '{}' (exit {})", cmd, code),
                        }
                    }
                    Err(e) => ToolExecutionResult {
                        ok: false,
                        output: format!("Command execution failed: {}", e),
                        summary: format!("Exec error: {}", e),
                    },
                }
            }

            unknown => ToolExecutionResult {
                ok: false,
                output: format!("Unknown tool: {}", unknown),
                summary: format!("Unknown tool: {}", unknown),
            },
        }
    }
}

/// Async execution path for I/O-heavy tools (`execute_command`, `generate_image`, `generate_video`).
/// Runs WITHOUT holding the SQLite store lock, reuses the shared `reqwest::Client`,
/// enforces a 60s timeout + `kill_on_drop(true)` on child processes, and supports instant task abort.
pub async fn execute_async_tool(
    workspace_root: &Path,
    http: &reqwest::Client,
    name: &str,
    args: &Value,
) -> Option<ToolExecutionResult> {
    match name {
        "execute_command" => {
            let cmd = args["command"].as_str().unwrap_or("");
            if cmd.is_empty() {
                return Some(ToolExecutionResult {
                    ok: false,
                    output: "Missing 'command' argument".to_string(),
                    summary: "Missing command".to_string(),
                });
            }

            let mut command = tokio::process::Command::new("powershell");
            #[cfg(target_os = "windows")]
            {
                command.creation_flags(0x08000000);
            }
            command
                .kill_on_drop(true)
                .arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-WindowStyle")
                .arg("Hidden")
                .arg("-Command")
                .arg(cmd)
                .current_dir(workspace_root);

            let timed = tokio::time::timeout(
                std::time::Duration::from_secs(60),
                command.output(),
            )
            .await;

            Some(match timed {
                Ok(Ok(out)) => {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    let code = out.status.code().unwrap_or(-1);
                    let max_len = 5000;
                    let comb = format!("Exit code: {}\nSTDOUT:\n{}\nSTDERR:\n{}", code, stdout, stderr);
                    let truncated = if comb.len() > max_len {
                        let safe_end = comb
                            .char_indices()
                            .take_while(|(i, _)| *i < max_len)
                            .last()
                            .map(|(i, ch)| i + ch.len_utf8())
                            .unwrap_or(0);
                        format!("{}\n...[truncated]", &comb[..safe_end])
                    } else {
                        comb
                    };
                    ToolExecutionResult {
                        ok: out.status.success(),
                        output: truncated,
                        summary: format!("Executed '{}' (exit {})", cmd, code),
                    }
                }
                Ok(Err(e)) => ToolExecutionResult {
                    ok: false,
                    output: format!("Command execution failed: {}", e),
                    summary: format!("Exec error: {}", e),
                },
                Err(_) => ToolExecutionResult {
                    ok: false,
                    output: "Command timed out after 60 seconds and was terminated.".to_string(),
                    summary: format!("Timed out: '{}'", cmd),
                },
            })
        }
        "generate_image" => {
            let prompt = args["prompt"].as_str().unwrap_or("");
            if prompt.is_empty() {
                return Some(ToolExecutionResult {
                    ok: false,
                    output: "Missing 'prompt' argument".to_string(),
                    summary: "Missing prompt".to_string(),
                });
            }
            let default_name = format!("assets/generated_{}.png", chrono::Utc::now().timestamp());
            let out_rel = args["output_path"].as_str().filter(|s| !s.is_empty()).unwrap_or(&default_name);
            let out_abs = match VaultFs::resolve_safe_path(workspace_root, out_rel) {
                Ok(p) => p,
                Err(e) => {
                    return Some(ToolExecutionResult {
                        ok: false,
                        output: format!("Invalid output_path: {}", e),
                        summary: "Invalid path".to_string(),
                    });
                }
            };
            if let Some(parent) = out_abs.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".to_string());
            let cfg_path = std::path::PathBuf::from(home).join(".oro").join("config.json");
            let cfg_json = std::fs::read_to_string(&cfg_path)
                .ok()
                .and_then(|c| serde_json::from_str::<Value>(&c).ok());
            let api_key = cfg_json
                .as_ref()
                .and_then(|v| v["providers"]["gemini"]["apiKey"].as_str().map(|s| s.to_string()))
                .or_else(|| std::env::var("GEMINI_API_KEY").ok())
                .unwrap_or_default();
            let image_model = cfg_json
                .as_ref()
                .and_then(|v| v["providers"]["gemini"]["imageModel"].as_str().map(|s| s.to_string()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "gemini-3.1-flash-image".to_string());

            if api_key.is_empty() {
                return Some(ToolExecutionResult {
                    ok: false,
                    output: "Gemini API key not configured in ~/.oro/config.json".to_string(),
                    summary: "Missing API key".to_string(),
                });
            }

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                image_model, api_key
            );
            let body = json!({
                "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
                "generationConfig": { "responseModalities": ["IMAGE"] }
            });

            let res: Result<Vec<u8>, String> = async {
                let resp = http.post(&url).json(&body).send().await.map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let err = resp.text().await.unwrap_or_default();
                    return Err(format!("Image API error ({}): {}", status, &err[..err.len().min(300)]));
                }
                let val: Value = resp.json().await.map_err(|e| e.to_string())?;
                let b64 = val["candidates"][0]["content"]["parts"]
                    .as_array()
                    .and_then(|parts| parts.iter().find_map(|p| p["inlineData"]["data"].as_str()))
                    .ok_or_else(|| "No image data returned by Gemini".to_string())?;

                let mut out = Vec::with_capacity(b64.len() * 3 / 4);
                let mut buf: u32 = 0;
                let mut bits: u8 = 0;
                for &b in b64.as_bytes() {
                    let v = match b {
                        b'A'..=b'Z' => b - b'A',
                        b'a'..=b'z' => b - b'a' + 26,
                        b'0'..=b'9' => b - b'0' + 52,
                        b'+' => 62,
                        b'/' => 63,
                        b'=' | b'\n' | b'\r' | b' ' => continue,
                        _ => return Err("Invalid base64 character".to_string()),
                    };
                    buf = (buf << 6) | (v as u32);
                    bits += 6;
                    if bits >= 8 {
                        bits -= 8;
                        out.push(((buf >> bits) & 0xFF) as u8);
                    }
                }
                Ok(out)
            }
            .await;

            Some(match res {
                Ok(bytes) => {
                    if let Err(e) = std::fs::write(&out_abs, &bytes) {
                        ToolExecutionResult {
                            ok: false,
                            output: format!("Failed to save image: {}", e),
                            summary: "Save failed".to_string(),
                        }
                    } else {
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Successfully generated image at {} ({} bytes).", out_rel, bytes.len()),
                            summary: format!("Generated {}", out_rel),
                        }
                    }
                }
                Err(e) => ToolExecutionResult {
                    ok: false,
                    output: e,
                    summary: "Image generation failed".to_string(),
                },
            })
        }
        "generate_video" => {
            let prompt = args["prompt"].as_str().unwrap_or("");
            if prompt.is_empty() {
                return Some(ToolExecutionResult {
                    ok: false,
                    output: "Missing 'prompt' argument".to_string(),
                    summary: "Missing prompt".to_string(),
                });
            }
            let out_rel = args["output_path"]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or("generated_video.mp4");
            let aspect_ratio = args["aspect_ratio"]
                .as_str()
                .filter(|s| *s == "16:9" || *s == "9:16")
                .unwrap_or("16:9");

            let out_abs = match VaultFs::resolve_safe_path(workspace_root, out_rel) {
                Ok(p) => p,
                Err(e) => {
                    return Some(ToolExecutionResult {
                        ok: false,
                        output: format!("Invalid output_path: {}", e),
                        summary: "Invalid path".to_string(),
                    });
                }
            };
            if let Some(parent) = out_abs.parent() {
                let _ = std::fs::create_dir_all(parent);
            }

            let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".to_string());
            let cfg_path = std::path::PathBuf::from(home).join(".oro").join("config.json");
            let cfg_json = std::fs::read_to_string(&cfg_path)
                .ok()
                .and_then(|c| serde_json::from_str::<Value>(&c).ok());
            let api_key = cfg_json
                .as_ref()
                .and_then(|v| v["providers"]["gemini"]["apiKey"].as_str().map(|s| s.to_string()))
                .or_else(|| std::env::var("GEMINI_API_KEY").ok())
                .unwrap_or_default();
            let video_model = cfg_json
                .as_ref()
                .and_then(|v| v["providers"]["gemini"]["videoModel"].as_str().map(|s| s.to_string()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "veo-3.1-generate-preview".to_string());

            if api_key.is_empty() {
                return Some(ToolExecutionResult {
                    ok: false,
                    output: "Gemini API key not configured in ~/.oro/config.json".to_string(),
                    summary: "Missing API key".to_string(),
                });
            }

            let res: Result<Vec<u8>, String> = async {
                let start_url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/models/{}:predictLongRunning?key={}",
                    video_model, api_key
                );
                let body = json!({
                    "instances": [{ "prompt": prompt }],
                    "parameters": {
                        "sampleCount": 1,
                        "resolution": "720p",
                        "aspectRatio": aspect_ratio
                    }
                });
                let resp = http.post(&start_url).json(&body).send().await.map_err(|e| e.to_string())?;
                if !resp.status().is_success() {
                    let status = resp.status();
                    let err = resp.text().await.unwrap_or_default();
                    return Err(format!("Video API error ({}): {}", status, &err[..err.len().min(300)]));
                }
                let start_val: Value = resp.json().await.map_err(|e| e.to_string())?;
                let op_name = start_val["name"]
                    .as_str()
                    .ok_or_else(|| "Video API did not return an operation name".to_string())?;

                let poll_url = format!(
                    "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                    op_name.trim_start_matches('/'),
                    api_key
                );
                let mut completed_val: Option<Value> = None;
                for _ in 0..36 {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    let poll_resp = http.get(&poll_url).send().await.map_err(|e| e.to_string())?;
                    if !poll_resp.status().is_success() {
                        let status = poll_resp.status();
                        let err = poll_resp.text().await.unwrap_or_default();
                        return Err(format!("Video poll error ({}): {}", status, &err[..err.len().min(300)]));
                    }
                    let val: Value = poll_resp.json().await.map_err(|e| e.to_string())?;
                    if val["done"].as_bool().unwrap_or(false) {
                        if let Some(err_obj) = val.get("error") {
                            return Err(format!("Video generation failed: {}", err_obj));
                        }
                        completed_val = Some(val);
                        break;
                    }
                }

                let done_val = completed_val
                    .ok_or_else(|| "Video generation timed out after 180 seconds".to_string())?;
                let video_uri = done_val["response"]["generateVideoResponse"]["generatedSamples"][0]["video"]["uri"]
                    .as_str()
                    .ok_or_else(|| "No video URI returned by Veo".to_string())?;

                let download_url = if video_uri.contains("key=") {
                    video_uri.to_string()
                } else if video_uri.contains('?') {
                    format!("{}&key={}", video_uri, api_key)
                } else {
                    format!("{}?key={}", video_uri, api_key)
                };

                let dl_resp = http.get(&download_url).send().await.map_err(|e| e.to_string())?;
                if !dl_resp.status().is_success() {
                    return Err(format!("Failed to download generated video ({})", dl_resp.status()));
                }
                let bytes = dl_resp.bytes().await.map_err(|e| e.to_string())?;
                Ok(bytes.to_vec())
            }
            .await;

            Some(match res {
                Ok(bytes) => {
                    if let Err(e) = std::fs::write(&out_abs, &bytes) {
                        ToolExecutionResult {
                            ok: false,
                            output: format!("Failed to save video: {}", e),
                            summary: "Save failed".to_string(),
                        }
                    } else {
                        ToolExecutionResult {
                            ok: true,
                            output: format!("Successfully generated video at {} ({} bytes).", out_rel, bytes.len()),
                            summary: format!("Generated {}", out_rel),
                        }
                    }
                }
                Err(e) => ToolExecutionResult {
                    ok: false,
                    output: e,
                    summary: "Video generation failed".to_string(),
                },
            })
        }
        _ => None,
    }
}
