use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;
use crate::agent::provider::{LlmClient, ProviderConfig};
use crate::agent::snapshot::SnapshotManager;
use crate::db::{
    ChatMessageRecord, CoworkerApproval, CoworkerGoal, CoworkerStore, CoworkerTask,
    EditorDraftRecord, MemoryRecord, NoteLinkRecord, RollbackResult, SessionFileRecord,
    SessionRecord, TaskRecord, TurnSnapshotRecord,
};
use crate::scheduler::{CoworkerScheduler, SchedulerSnapshot, ShiftState};
use crate::vault::fs::{MoveResult, ReadFileResult, TreeNode, VaultFs, WriteFileResult};
use crate::vault::graph::KnowledgeGraph;
use crate::vault::indexer::{BacklinksResult, SearchHit, VaultIndexer, VaultStats};

pub struct AppState {
    pub store: Arc<Mutex<CoworkerStore>>,
    pub scheduler: Arc<CoworkerScheduler>,
    pub workspace_root: Arc<Mutex<PathBuf>>,
    pub llm_client: Arc<LlmClient>,
}

// ==================== CO-WORKER COMMANDS ====================

#[tauri::command]
pub fn get_shift_status(state: State<'_, AppState>) -> Result<ShiftState, String> {
    Ok(state.scheduler.get_shift())
}

#[tauri::command]
pub fn set_shift_status(status: String, state: State<'_, AppState>) -> Result<ShiftState, String> {
    let new_shift = match status.as_str() {
        "stepping_away" | "away" => ShiftState::SteppingAway,
        "draining" => ShiftState::Draining,
        _ => ShiftState::AtDesk,
    };
    state.scheduler.set_shift(new_shift);
    Ok(new_shift)
}

#[tauri::command]
pub fn create_goal(
    title: String,
    description: Option<String>,
    token_budget: Option<i64>,
    state: State<'_, AppState>,
) -> Result<CoworkerGoal, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store
        .create_goal(&title, description.as_deref(), token_budget)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_goal(state: State<'_, AppState>) -> Result<Option<CoworkerGoal>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_active_goal().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(
    goal_id: String,
    title: String,
    role: String,
    model_tier: String,
    dependencies: Vec<String>,
    state: State<'_, AppState>,
) -> Result<CoworkerTask, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store
        .create_task(&goal_id, &title, &role, &model_tier, &dependencies)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tasks(goal_id: String, state: State<'_, AppState>) -> Result<Vec<CoworkerTask>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.list_tasks(&goal_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_approvals(
    goal_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<CoworkerApproval>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store
        .list_pending_approvals(goal_id.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resolve_approval(
    id: String,
    approved: bool,
    note: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    state
        .scheduler
        .resolve_approval(&id, approved, note.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_coworker_snapshot(state: State<'_, AppState>) -> Result<SchedulerSnapshot, String> {
    state
        .scheduler
        .get_snapshot()
        .map_err(|e| e.to_string())
}

// ==================== VAULT COMMANDS ====================

#[tauri::command]
pub fn get_workspace_root(state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn set_workspace_root(path: String, state: State<'_, AppState>) -> Result<VaultStats, String> {
    let new_root = PathBuf::from(&path);
    if !new_root.exists() {
        std::fs::create_dir_all(&new_root)
            .map_err(|e| format!("Failed to create workspace directory {}: {}", path, e))?;
    }

    {
        let mut root = state.workspace_root.lock().map_err(|e| e.to_string())?;
        *root = new_root.clone();
    }

    // Persist lastWorkspace in ~/.oro/config.json so reopening the app restores it
    let mut cfg = load_oro_config();
    if let Some(obj) = cfg.as_object_mut() {
        obj.insert("lastWorkspace".to_string(), serde_json::json!(path));
        if let Ok(json_str) = serde_json::to_string_pretty(&cfg) {
            let _ = std::fs::write(get_oro_home().join("config.json"), json_str);
        }
    }

    let store_arc = state.store.clone();
    let root_clone = new_root.clone();
    tokio::task::spawn_blocking(move || {
        let store = store_arc.lock().map_err(|e| e.to_string())?;
        VaultIndexer::index_all(&root_clone, &store).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_tree(sub_path: Option<String>, state: State<'_, AppState>) -> Result<Vec<TreeNode>, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    VaultFs::get_tree(&root, sub_path.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String, state: State<'_, AppState>) -> Result<ReadFileResult, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    VaultFs::read_file(&root, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<WriteFileResult, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    let res = VaultFs::write_file(&root, &path, &content).map_err(|e| e.to_string())?;

    // Incremental index update if markdown
    if path.ends_with(".md") || path.ends_with(".markdown") || path.ends_with(".txt") {
        let store = state.store.lock().map_err(|e| e.to_string())?;
        let parsed = crate::vault::parser::parse_markdown(&path, &content);
        let fm_json = serde_json::to_string(&parsed.frontmatter).unwrap_or_else(|_| "{}".to_string());
        let _ = store.upsert_note(
            &path,
            &parsed.title,
            &content,
            &fm_json,
            chrono::Utc::now().timestamp_millis() as f64,
            res.bytes,
            parsed.word_count,
            &parsed.links,
            &parsed.tags,
        );
        let _ = store.resolve_all_links();
    }

    Ok(res)
}

#[tauri::command]
pub fn delete_path(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    let res = VaultFs::delete_path(&root, &path).map_err(|e| e.to_string())?;

    let store = state.store.lock().map_err(|e| e.to_string())?;
    let _ = store.delete_note(&path);
    let _ = store.delete_notes_with_prefix(&path);

    Ok(res)
}

#[tauri::command]
pub fn move_path(from: String, to: String, state: State<'_, AppState>) -> Result<MoveResult, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    let res = VaultFs::move_path(&root, &from, &to).map_err(|e| e.to_string())?;

    // Full reindex to update links
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let _ = VaultIndexer::index_all(&root, &store);

    Ok(res)
}

#[tauri::command]
pub fn create_folder(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    VaultFs::create_folder(&root, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_vault(query: String, state: State<'_, AppState>) -> Result<Vec<SearchHit>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.search_vault(&query).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_backlinks(path: String, state: State<'_, AppState>) -> Result<BacklinksResult, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_backlinks(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_links(state: State<'_, AppState>) -> Result<Vec<NoteLinkRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_all_links().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_knowledge_graph(state: State<'_, AppState>) -> Result<KnowledgeGraph, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_knowledge_graph().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reindex_vault(state: State<'_, AppState>) -> Result<VaultStats, String> {
    let root = {
        let r = state.workspace_root.lock().map_err(|e| e.to_string())?;
        r.clone()
    };
    let store_arc = state.store.clone();
    tokio::task::spawn_blocking(move || {
        let store = store_arc.lock().map_err(|e| e.to_string())?;
        VaultIndexer::index_all(&root, &store).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ==================== CONFIG HELPERS ====================

fn get_oro_home() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".oro")
}

fn default_oro_config() -> serde_json::Value {
    serde_json::json!({
        "provider": "gemini",
        "defaultMode": "default",
        "maxAgentSteps": 12,
        "autoIndex": true,
        "safetyLevel": "autonomous",
        "providers": {
            "gemini": {
                "model": "gemini-3.8-flash",
                "baseUrl": "https://generativelanguage.googleapis.com/v1beta"
            },
            "openai": {
                "model": "gpt-4o-mini",
                "baseUrl": "https://api.openai.com/v1"
            },
            "anthropic": {
                "model": "claude-3-7-sonnet-latest",
                "baseUrl": "https://api.anthropic.com/v1"
            },
            "ollama": {
                "model": "llama3.2",
                "baseUrl": "http://localhost:11434"
            }
        },
        "editor": {
            "fontSize": 13,
            "fontPreset": "sans",
            "wordWrap": "on",
            "minimap": false,
            "lineNumbers": "on",
            "defaultView": "split"
        },
        "ui": {
            "theme": "dark",
            "systemFont": "default",
            "systemFontSize": 12,
            "systemScale": 100
        }
    })
}

fn load_oro_config() -> serde_json::Value {
    let p = get_oro_home().join("config.json");
    let mut val = if let Ok(c) = std::fs::read_to_string(&p) {
        serde_json::from_str(&c).unwrap_or_else(|_| default_oro_config())
    } else {
        default_oro_config()
    };

    // Auto-migrate legacy deprecated models (gemini 1.x and 2.x -> gemini-3.8-flash)
    let mut needs_save = false;
    if let Some(providers) = val.get_mut("providers").and_then(|p| p.as_object_mut()) {
        if let Some(gemini) = providers.get_mut("gemini").and_then(|g| g.as_object_mut()) {
            if let Some(m) = gemini.get("model").and_then(|m| m.as_str()) {
                if m.starts_with("gemini-1.") || m.starts_with("gemini-2.") {
                    gemini.insert("model".to_string(), serde_json::json!("gemini-3.8-flash"));
                    needs_save = true;
                }
            }
            // Populate environment key if not explicitly set
            if gemini.get("apiKey").and_then(|k| k.as_str()).map_or(true, |k| k.trim().is_empty()) {
                if let Ok(env_key) = std::env::var("GEMINI_API_KEY").or_else(|_| std::env::var("GOOGLE_API_KEY")) {
                    if !env_key.trim().is_empty() {
                        gemini.insert("apiKey".to_string(), serde_json::json!(env_key.trim()));
                    }
                }
            }
        }
        if let Some(openai) = providers.get_mut("openai").and_then(|o| o.as_object_mut()) {
            if openai.get("apiKey").and_then(|k| k.as_str()).map_or(true, |k| k.trim().is_empty()) {
                if let Ok(env_key) = std::env::var("OPENAI_API_KEY") {
                    if !env_key.trim().is_empty() {
                        openai.insert("apiKey".to_string(), serde_json::json!(env_key.trim()));
                    }
                }
            }
        }
        if let Some(anthropic) = providers.get_mut("anthropic").and_then(|a| a.as_object_mut()) {
            if anthropic.get("apiKey").and_then(|k| k.as_str()).map_or(true, |k| k.trim().is_empty()) {
                if let Ok(env_key) = std::env::var("ANTHROPIC_API_KEY") {
                    if !env_key.trim().is_empty() {
                        anthropic.insert("apiKey".to_string(), serde_json::json!(env_key.trim()));
                    }
                }
            }
        }
    }

    if needs_save {
        let _ = save_oro_config_file(&val);
    }

    val
}

fn save_oro_config_file(v: &serde_json::Value) -> Result<(), String> {
    let dir = get_oro_home();
    let _ = std::fs::create_dir_all(&dir);
    let p = dir.join("config.json");
    let s = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    std::fs::write(&p, s).map_err(|e| e.to_string())
}

// ==================== AGENT & CHAT COMMANDS ====================

#[tauri::command]
pub async fn send_chat_message(
    app: tauri::AppHandle,
    session_id: String,
    _mode: Option<String>,
    prompt: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = {
        let r = state.workspace_root.lock().map_err(|e| e.to_string())?;
        r.clone()
    };
    let snap_mgr = SnapshotManager::new(&root);
    let llm_client = state.llm_client.clone();

    // Read active provider config
    let cfg_json = load_oro_config();
    let prov_name = cfg_json["provider"].as_str().unwrap_or("gemini").to_string();
    let prov_obj = &cfg_json["providers"][&prov_name];
    let model = prov_obj["model"].as_str().unwrap_or("gemini-3.8-flash").to_string();
    let api_key = prov_obj["apiKey"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| match prov_name.as_str() {
            "gemini" => std::env::var("GEMINI_API_KEY").ok().or_else(|| std::env::var("GOOGLE_API_KEY").ok()),
            "openai" => std::env::var("OPENAI_API_KEY").ok(),
            "anthropic" => std::env::var("ANTHROPIC_API_KEY").ok(),
            _ => None,
        });
    let base_url = prov_obj["baseUrl"].as_str().map(|s| s.to_string());
    let reasoning_effort = prov_obj["reasoningEffort"].as_str().map(|s| s.to_string());

    let provider_cfg = ProviderConfig {
        provider: prov_name,
        model,
        api_key,
        base_url,
        reasoning_effort,
    };

    let max_steps = cfg_json["maxAgentSteps"].as_u64().unwrap_or(12) as usize;
    let store_arc = state.store.clone();

    tokio::spawn(async move {
        use tauri::Emitter;
        let emit_handle = app.clone();
        let emit_fn = move |evt: crate::agent::orchestrator::StreamEvent| {
            let _ = emit_handle.emit("stream-event", evt);
        };

        let orchestrator = crate::agent::orchestrator::AgentOrchestrator::new(
            root,
            store_arc,
            snap_mgr,
            llm_client,
        );

        if let Err(err) = orchestrator
            .run_turn(&session_id, &prompt, &provider_cfg, max_steps, emit_fn.clone())
            .await
        {
            emit_fn(crate::agent::orchestrator::StreamEvent {
                r#type: "error".to_string(),
                mode: None,
                phase: None,
                phase_detail: None,
                text_delta: None,
                tool_call: None,
                tool_result: None,
                snapshot: None,
                error: Some(err),
            });
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_chat(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    let _ = app.emit(
        "stream-event",
        crate::agent::orchestrator::StreamEvent {
            r#type: "done".to_string(),
            mode: None,
            phase: None,
            phase_detail: None,
            text_delta: None,
            tool_call: None,
            tool_result: None,
            snapshot: None,
            error: None,
        },
    );
    Ok(())
}

// ==================== SESSIONS & MESSAGES ====================

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionRecord>, String> {
    let root_norm = state
        .workspace_root
        .lock()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.list_sessions_for_workspace(&root_norm).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session(id: String, state: State<'_, AppState>) -> Result<Option<SessionRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_session(
    title: Option<String>,
    mode: Option<String>,
    state: State<'_, AppState>,
) -> Result<SessionRecord, String> {
    let root_norm = state
        .workspace_root
        .lock()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let cfg = load_oro_config();
    let prov = cfg["provider"].as_str().unwrap_or("gemini");
    let model = cfg["providers"][prov]["model"].as_str().unwrap_or("gemini-3.8-flash");

    store
        .create_session_for_workspace(
            title.as_deref(),
            mode.as_deref(),
            Some(prov),
            Some(model),
            &root_norm,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_session(
    id: String,
    title: Option<String>,
    mode: Option<String>,
    summary: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store
        .update_session(&id, title.as_deref(), mode.as_deref(), summary.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_session(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_messages(session_id: String, state: State<'_, AppState>) -> Result<Vec<ChatMessageRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.list_messages(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_messages(ids: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_messages(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_files(session_id: String, state: State<'_, AppState>) -> Result<Vec<SessionFileRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.list_session_files(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_file_pinned(
    session_id: String,
    path: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.set_file_pinned(&session_id, &path, pinned).map_err(|e| e.to_string())
}

// ==================== MEMORIES ====================

#[tauri::command]
pub fn list_memories(
    query: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<MemoryRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    match query {
        Some(ref q) if !q.is_empty() => store.search_memories(q, limit).map_err(|e| e.to_string()),
        _ => store.list_memories(limit).map_err(|e| e.to_string()),
    }
}

#[tauri::command]
pub fn save_memory(
    content: String,
    category: Option<String>,
    tags: Option<Vec<String>>,
    importance: Option<i64>,
    state: State<'_, AppState>,
) -> Result<MemoryRecord, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let tags_slice = tags.unwrap_or_default();
    store
        .save_memory(&content, category.as_deref(), &tags_slice, importance, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_memory(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_memory(id).map_err(|e| e.to_string())
}

// ==================== TASKS ====================

#[tauri::command]
pub fn list_tasks_all(
    include_done: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<TaskRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let all = store.list_tasks_all().map_err(|e| e.to_string())?;
    let inc = include_done.unwrap_or(false);
    Ok(all.into_iter().filter(|t| inc || !t.done).collect())
}

#[tauri::command]
pub fn add_task(
    title: String,
    file_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<TaskRecord, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.add_task(&title, file_path.as_deref(), None).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_task(
    id: i64,
    done: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Option<TaskRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.toggle_task(id, done).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_task(id).map_err(|e| e.to_string())
}

// ==================== SNAPSHOTS & ROLLBACK ====================

#[tauri::command]
pub fn list_snapshots(session_id: String, state: State<'_, AppState>) -> Result<Vec<TurnSnapshotRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.list_turn_snapshots(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rollback_snapshot(snapshot_id: String, state: State<'_, AppState>) -> Result<RollbackResult, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    let store = state.store.lock().map_err(|e| e.to_string())?;
    let snap_mgr = SnapshotManager::new(&*root);
    snap_mgr.rollback(&snapshot_id, &store)
}

// ==================== EDITOR DRAFTS ====================

#[tauri::command]
pub fn list_drafts(state: State<'_, AppState>) -> Result<Vec<EditorDraftRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.list_drafts().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_draft(path: String, state: State<'_, AppState>) -> Result<Option<EditorDraftRecord>, String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.get_draft(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_draft(path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.save_draft(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_draft(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.delete_draft(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_all_drafts(state: State<'_, AppState>) -> Result<(), String> {
    let store = state.store.lock().map_err(|e| e.to_string())?;
    store.clear_all_drafts().map_err(|e| e.to_string())
}

// ==================== CONFIG COMMANDS ====================

#[tauri::command]
pub fn get_config() -> Result<serde_json::Value, String> {
    Ok(load_oro_config())
}

#[tauri::command]
pub fn save_config(patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let mut current = load_oro_config();
    fn merge_json(target: &mut serde_json::Value, source: &serde_json::Value) {
        if let (Some(t_obj), Some(s_obj)) = (target.as_object_mut(), source.as_object()) {
            for (k, v) in s_obj {
                if v.is_object() && t_obj.get(k).map_or(false, |old| old.is_object()) {
                    merge_json(t_obj.get_mut(k).unwrap(), v);
                } else {
                    t_obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
    merge_json(&mut current, &patch);
    save_oro_config_file(&current)?;
    Ok(current)
}

#[tauri::command]
pub fn save_provider_key(provider: String, api_key: String) -> Result<(), String> {
    let mut current = load_oro_config();
    if let Some(obj) = current.as_object_mut() {
        obj.insert("provider".to_string(), serde_json::Value::String(provider.clone()));
        let provs = obj.entry("providers").or_insert_with(|| serde_json::json!({}));
        if let Some(p_obj) = provs.as_object_mut() {
            let specific = p_obj.entry(&provider).or_insert_with(|| serde_json::json!({}));
            if let Some(s_obj) = specific.as_object_mut() {
                s_obj.insert("apiKey".to_string(), serde_json::Value::String(api_key));
            }
        }
    }
    save_oro_config_file(&current)
}

#[tauri::command]
pub fn save_provider_model(
    provider: String,
    model: String,
    base_url: Option<String>,
    reasoning_effort: Option<String>,
) -> Result<(), String> {
    let mut current = load_oro_config();
    if let Some(obj) = current.as_object_mut() {
        let provs = obj.entry("providers").or_insert_with(|| serde_json::json!({}));
        if let Some(p_obj) = provs.as_object_mut() {
            let specific = p_obj.entry(&provider).or_insert_with(|| serde_json::json!({}));
            if let Some(s_obj) = specific.as_object_mut() {
                s_obj.insert("model".to_string(), serde_json::Value::String(model));
                if let Some(bu) = base_url {
                    s_obj.insert("baseUrl".to_string(), serde_json::Value::String(bu));
                }
                if let Some(re) = reasoning_effort {
                    s_obj.insert("reasoningEffort".to_string(), serde_json::Value::String(re));
                }
            }
        }
    }
    save_oro_config_file(&current)
}

// ==================== WORKSPACE INFO ====================

#[tauri::command]
pub fn get_workspace_info(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    let root_str = root.to_string_lossy().to_string();
    let name = root.file_name().and_then(|n| n.to_str()).unwrap_or("Workspace").to_string();

    let store = state.store.lock().map_err(|e| e.to_string())?;
    let all_links = store.get_all_links().unwrap_or_default();
    let broken = all_links.iter().filter(|l| l.target_resolved.is_none()).count();

    let mut notes_count = 0;
    if let Ok(tree) = VaultFs::get_tree(&root, None) {
        fn count_notes(nodes: &[TreeNode]) -> usize {
            let mut c = 0;
            for n in nodes {
                if n.node_type != "directory" && (n.path.ends_with(".md") || n.path.ends_with(".markdown") || n.path.ends_with(".txt")) {
                    c += 1;
                }
                if let Some(ref children) = n.children {
                    c += count_notes(children);
                }
            }
            c
        }
        notes_count = count_notes(&tree);
    }

    let memories_count = store.list_memories(Some(1000)).map(|m| m.len()).unwrap_or(0);
    let tasks = store.list_tasks_all().unwrap_or_default();
    let open_tasks = tasks.iter().filter(|t| !t.done).count();

    Ok(serde_json::json!({
        "root": root_str,
        "name": name,
        "stats": {
            "notes": notes_count,
            "links": all_links.len(),
            "brokenLinks": broken,
            "tags": 0,
            "memories": memories_count,
            "openTasks": open_tasks
        }
    }))
}

// ==================== WINDOW & SHELL COMMANDS ====================

#[tauri::command]
pub fn set_zoom_factor(factor: f64, window: tauri::WebviewWindow) -> Result<(), String> {
    window.set_zoom(factor).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_control(action: String, window: tauri::Window) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|e| e.to_string()),
        "maximize" => {
            let is_max = window.is_maximized().map_err(|e| e.to_string())?;
            if is_max {
                window.unmaximize().map_err(|e| e.to_string())
            } else {
                window.maximize().map_err(|e| e.to_string())
            }
        }
        "close" => {
            // Hide window to system tray so autonomous Co-Worker scheduler continues running
            window.hide().map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown window action: {}", action)),
    }
}

#[tauri::command]
pub async fn select_workspace_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        tokio::task::spawn_blocking(|| {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let output = std::process::Command::new("powershell")
                .creation_flags(CREATE_NO_WINDOW)
                .arg("-NoProfile")
                .arg("-NonInteractive")
                .arg("-WindowStyle")
                .arg("Hidden")
                .arg("-STA")
                .arg("-Command")
                .arg(r#"Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select Workspace Folder'; $d.ShowNewFolderButton = $true; $d.AutoUpgradeEnabled = $true; $top = New-Object System.Windows.Forms.Form; $top.TopMost = $true; if ($d.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }"#)
                .output()
                .map_err(|e| e.to_string())?;

            let res = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if res.is_empty() {
                Ok(None)
            } else {
                Ok(Some(res))
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub fn reveal_in_explorer(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
    let full = if path.is_empty() {
        root.clone()
    } else {
        let p = Path::new(&path);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            root.join(&path)
        }
    };

    #[cfg(target_os = "windows")]
    {
        if full.is_file() {
            let _ = std::process::Command::new("explorer")
                .arg(format!("/select,\"{}\"", full.to_string_lossy()))
                .spawn();
        } else {
            let _ = std::process::Command::new("explorer")
                .arg(full.to_string_lossy().to_string())
                .spawn();
        }
    }

    Ok(serde_json::json!({
        "success": true,
        "path": full.to_string_lossy().to_string()
    }))
}

#[tauri::command]
pub fn open_external(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        #[cfg(target_os = "windows")]
        {
            let _ = std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", &path])
                .spawn();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("open").arg(&path).spawn();
        }
        return Ok(serde_json::json!({ "opener": "system_browser", "target": path }));
    }

    let p = Path::new(&path);
    let final_path = if p.is_absolute() {
        p.to_path_buf()
    } else {
        let root = state.workspace_root.lock().map_err(|e| e.to_string())?;
        root.join(&path)
    };

    #[cfg(target_os = "windows")]
    {
        if final_path.is_dir() {
            let _ = std::process::Command::new("explorer")
                .arg(&final_path)
                .spawn();
        } else {
            let _ = std::process::Command::new("rundll32")
                .args(["url.dll,FileProtocolHandler", &final_path.to_string_lossy()])
                .spawn();
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&final_path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&final_path).spawn();
    }

    Ok(serde_json::json!({ "opener": "system_explorer", "target": final_path.to_string_lossy().to_string() }))
}

#[tauri::command]
pub fn get_recent_workspaces() -> Result<Vec<serde_json::Value>, String> {
    let p = get_oro_home().join("recent.json");
    if let Ok(c) = std::fs::read_to_string(&p) {
        let v: Vec<serde_json::Value> = serde_json::from_str(&c).unwrap_or_default();
        Ok(v)
    } else {
        Ok(Vec::new())
    }
}

