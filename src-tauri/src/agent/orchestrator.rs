use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::mpsc;
use crate::agent::compaction::{build_compaction_prompt, build_local_fallback_summary, compact_for_context};
use crate::agent::provider::{LlmClient, LlmMessage, LlmStreamEvent, ProviderConfig, ToolCall};
use crate::agent::snapshot::SnapshotManager;
use crate::agent::tools::{execute_async_tool, get_agent_tools, ToolExecutor};
use crate::db::{CoworkerStore, TurnSnapshotRecord};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallPayload {
    pub id: String,
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultPayload {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub ok: bool,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    pub r#type: String, // "text" | "tool_call" | "tool_result" | "done" | "error" | "mode_decided" | "phase_changed" | "snapshot"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase_detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<ToolCallPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_result: Option<ToolResultPayload>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<TurnSnapshotRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub struct AgentOrchestrator {
    pub workspace_root: PathBuf,
    pub store: Arc<Mutex<CoworkerStore>>,
    pub snapshot_manager: SnapshotManager,
    pub llm_client: Arc<LlmClient>,
}

impl AgentOrchestrator {
    pub fn new(
        workspace_root: PathBuf,
        store: Arc<Mutex<CoworkerStore>>,
        snapshot_manager: SnapshotManager,
        llm_client: Arc<LlmClient>,
    ) -> Self {
        Self {
            workspace_root,
            store,
            snapshot_manager,
            llm_client,
        }
    }

    pub async fn run_turn<F>(
        &self,
        session_id: &str,
        user_prompt: &str,
        provider_cfg: &ProviderConfig,
        max_steps: usize,
        emit_event: F,
    ) -> Result<(), String>
    where
        F: Fn(StreamEvent) + Send + Sync + 'static,
    {
        emit_event(StreamEvent {
            r#type: "mode_decided".to_string(),
            mode: Some("orchestrator".to_string()),
            phase: None,
            phase_detail: None,
            text_delta: None,
            tool_call: None,
            tool_result: None,
            snapshot: None,
            error: None,
        });

        // 1. Build context: pinned files, relevant memories
        let (pinned_files, memories) = {
            let store = self.store.lock().map_err(|e| e.to_string())?;
            let pf = store.list_session_files(session_id).unwrap_or_default();
            let mem = store.search_memories(user_prompt, Some(5)).unwrap_or_default();
            (pf, mem)
        };

        let mut pinned_context = String::new();
        for pf in &pinned_files {
            if pf.pinned
                && let Ok(c) = std::fs::read_to_string(self.workspace_root.join(&pf.path)) {
                    pinned_context.push_str(&format!("\n=== Pinned File: {} ===\n{}\n", pf.path, c));
                }
        }

        let mut memory_context = String::new();
        if !memories.is_empty() {
            memory_context.push_str("\n=== Persistent Memories ===\n");
            for m in &memories {
                memory_context.push_str(&format!("- [{}] {}\n", m.category, m.content));
            }
        }

        let system_prompt = format!(
            r#"You are Oro, an expert autonomous AI software engineer and Second Brain coworker.
You operate natively inside the user's workspace with full access to files, tests, terminal commands, memories, and notes.

Guiding Principles:
1. Zero AI Slop: Write crisp, idiomatic, high-performance code with proper error handling.
2. Safety First: Any destructive action is guarded by automated zero-token snapshots for 1-click rollback.
3. Verification: Always inspect and verify code changes.
4. Autonomous Execution: Proactively read context, inspect files, formulate solutions, and execute micro-diff edits.
5. Strict Honesty & No Unsolicited Workarounds: When the user asks to generate an image or video, you MUST call `generate_image` or `generate_video` — NEVER write Python/SVG/animation scripts as a substitute. If a tool or requested action fails, report the exact failure clearly and stop; do not invent alternative workarounds unless the user asks.

{}
{}"#,
            pinned_context, memory_context
        );

        // 2. Load message history from DB
        let db_messages = {
            let store = self.store.lock().map_err(|e| e.to_string())?;
            store.list_messages(session_id).unwrap_or_default()
        };

        // 2b. Handle `/compact [optional focus]` slash command
        let trimmed_prompt = user_prompt.trim();
        if trimmed_prompt.eq_ignore_ascii_case("/compact")
            || trimmed_prompt.to_lowercase().starts_with("/compact ")
        {
            let focus = trimmed_prompt
                .strip_prefix("/compact")
                .or_else(|| trimmed_prompt.strip_prefix("/COMPACT"))
                .map(|s| s.trim())
                .filter(|s| !s.is_empty());

            if db_messages.len() < 2 {
                let msg = "Nothing to compact yet — this session only has a few messages.";
                emit_event(StreamEvent {
                    r#type: "text".to_string(),
                    mode: None,
                    phase: None,
                    phase_detail: None,
                    text_delta: Some(msg.to_string()),
                    tool_call: None,
                    tool_result: None,
                    snapshot: None,
                    error: None,
                });
                emit_event(StreamEvent {
                    r#type: "done".to_string(),
                    mode: None,
                    phase: None,
                    phase_detail: None,
                    text_delta: None,
                    tool_call: None,
                    tool_result: None,
                    snapshot: None,
                    error: None,
                });
                return Ok(());
            }

            let compact_prompt = build_compaction_prompt(&db_messages, focus);
            let (tx, mut rx) = mpsc::channel(64);
            let client = self.llm_client.clone();
            let cfg_clone = ProviderConfig {
                provider: provider_cfg.provider.clone(),
                model: provider_cfg.model.clone(),
                api_key: provider_cfg.api_key.clone(),
                base_url: provider_cfg.base_url.clone(),
                reasoning_effort: Some("low".to_string()),
            };
            let compact_msgs = vec![LlmMessage {
                role: "user".to_string(),
                content: compact_prompt,
                tool_calls: None,
                tool_name: None,
                tool_call_id: None,
            }];

            tokio::spawn(async move {
                if let Err(e) = client
                    .stream_chat(
                        &cfg_clone,
                        "You are a concise technical summarizer.",
                        &compact_msgs,
                        &[],
                        tx.clone(),
                    )
                    .await
                {
                    let _ = tx.send(LlmStreamEvent::Error { error: e }).await;
                }
            });

            let header = format!(
                "### Compacted Context ({} messages condensed)\n\n",
                db_messages.len()
            );
            emit_event(StreamEvent {
                r#type: "text".to_string(),
                mode: None,
                phase: None,
                phase_detail: None,
                text_delta: Some(header.clone()),
                tool_call: None,
                tool_result: None,
                snapshot: None,
                error: None,
            });

            let mut summary_body = String::new();
            while let Some(evt) = rx.recv().await {
                match evt {
                    LlmStreamEvent::Text { delta } => {
                        summary_body.push_str(&delta);
                        emit_event(StreamEvent {
                            r#type: "text".to_string(),
                            mode: None,
                            phase: None,
                            phase_detail: None,
                            text_delta: Some(delta),
                            tool_call: None,
                            tool_result: None,
                            snapshot: None,
                            error: None,
                        });
                    }
                    LlmStreamEvent::Done => break,
                    LlmStreamEvent::Error { .. } => {
                        if summary_body.is_empty() {
                            let fb = build_local_fallback_summary(&db_messages);
                            summary_body.push_str(&fb);
                            emit_event(StreamEvent {
                                r#type: "text".to_string(),
                                mode: None,
                                phase: None,
                                phase_detail: None,
                                text_delta: Some(fb),
                                tool_call: None,
                                tool_result: None,
                                snapshot: None,
                                error: None,
                            });
                        }
                        break;
                    }
                    _ => {}
                }
            }

            let full_summary = format!("{}{}", header, summary_body.trim());
            let old_ids: Vec<String> = db_messages.iter().map(|m| m.id.clone()).collect();
            {
                let store = self.store.lock().map_err(|e| e.to_string())?;
                let _ = store.delete_messages(&old_ids);
                let _ = store.append_message(session_id, "assistant", &full_summary, None, None, None);
                let _ = store.update_session(session_id, None, None, Some(summary_body.trim()));
            }

            emit_event(StreamEvent {
                r#type: "done".to_string(),
                mode: None,
                phase: None,
                phase_detail: None,
                text_delta: None,
                tool_call: None,
                tool_result: None,
                snapshot: None,
                error: None,
            });
            return Ok(());
        }

        let mut llm_messages: Vec<LlmMessage> = db_messages
            .into_iter()
            .map(|m| {
                let tool_calls: Option<Vec<ToolCall>> = m.tool_args.as_deref().and_then(|args| {
                    serde_json::from_str(args).ok()
                });
                LlmMessage {
                    role: m.role,
                    content: m.content,
                    tool_calls,
                    tool_name: m.tool_name,
                    tool_call_id: m.tool_call_id,
                }
            })
            .collect();

        // 3. Append user message
        {
            let store = self.store.lock().map_err(|e| e.to_string())?;
            let _ = store.append_message(session_id, "user", user_prompt, None, None, None);
        }

        llm_messages.push(LlmMessage {
            role: "user".to_string(),
            content: user_prompt.to_string(),
            tool_calls: None,
            tool_name: None,
            tool_call_id: None,
        });

        // 4. Begin snapshot context
        let mut turn_ctx = self.snapshot_manager.begin_turn(session_id, user_prompt, 1);
        let tools = get_agent_tools();

        let mut step = 0;
        let max_steps_limit = if max_steps == 0 { 12 } else { max_steps };

        while step < max_steps_limit {
            step += 1;

            let (tx, mut rx) = mpsc::channel(100);
            let client = self.llm_client.clone();
            let cfg_clone = ProviderConfig {
                provider: provider_cfg.provider.clone(),
                model: provider_cfg.model.clone(),
                api_key: provider_cfg.api_key.clone(),
                base_url: provider_cfg.base_url.clone(),
                reasoning_effort: provider_cfg.reasoning_effort.clone(),
            };
            let sp_clone = system_prompt.clone();
            let msgs_clone = compact_for_context(llm_messages.clone(), 60_000);
            let tools_clone = tools.clone();

            tokio::spawn(async move {
                if let Err(e) = client
                    .stream_chat(&cfg_clone, &sp_clone, &msgs_clone, &tools_clone, tx.clone())
                    .await
                {
                    let _ = tx.send(LlmStreamEvent::Error { error: e }).await;
                }
            });

            let mut assistant_text = String::new();
            let mut turn_tool_calls: Vec<ToolCall> = Vec::new();

            while let Some(evt) = rx.recv().await {
                match evt {
                    LlmStreamEvent::Text { delta } => {
                        assistant_text.push_str(&delta);
                        emit_event(StreamEvent {
                            r#type: "text".to_string(),
                            mode: None,
                            phase: None,
                            phase_detail: None,
                            text_delta: Some(delta),
                            tool_call: None,
                            tool_result: None,
                            snapshot: None,
                            error: None,
                        });
                    }
                    LlmStreamEvent::ToolCall { call } => {
                        emit_event(StreamEvent {
                            r#type: "tool_call".to_string(),
                            mode: None,
                            phase: None,
                            phase_detail: None,
                            text_delta: None,
                            tool_call: Some(ToolCallPayload {
                                id: call.id.clone(),
                                name: call.name.clone(),
                                args: call.args.clone(),
                            }),
                            tool_result: None,
                            snapshot: None,
                            error: None,
                        });
                        turn_tool_calls.push(call);
                    }
                    LlmStreamEvent::Done => break,
                    LlmStreamEvent::Error { error } => {
                        if let Ok(store) = self.store.lock() {
                            let err_text = format!("⚠ {}", error);
                            let _ = store.append_message(session_id, "assistant", &err_text, None, None, None);
                        }
                        emit_event(StreamEvent {
                            r#type: "error".to_string(),
                            mode: None,
                            phase: None,
                            phase_detail: None,
                            text_delta: None,
                            tool_call: None,
                            tool_result: None,
                            snapshot: None,
                            error: Some(error.clone()),
                        });
                        return Err(error);
                    }
                }
            }

            // If assistant produced tool calls
            if !turn_tool_calls.is_empty() {
                let calls_json = serde_json::to_string(&turn_tool_calls).unwrap_or_default();
                {
                    let store = self.store.lock().map_err(|e| e.to_string())?;
                    let _ = store.append_message(
                        session_id,
                        "assistant",
                        &assistant_text,
                        None,
                        None,
                        Some(&calls_json),
                    );
                }

                llm_messages.push(LlmMessage {
                    role: "assistant".to_string(),
                    content: assistant_text.clone(),
                    tool_calls: Some(turn_tool_calls.clone()),
                    tool_name: None,
                    tool_call_id: None,
                });

                for tc in &turn_tool_calls {
                    let res = if let Some(async_res) =
                        execute_async_tool(&self.workspace_root, &self.llm_client.http, &tc.name, &tc.args).await
                    {
                        async_res
                    } else {
                        let store = self.store.lock().map_err(|e| e.to_string())?;
                        let executor = ToolExecutor::new(
                            &self.workspace_root,
                            &store,
                            &self.snapshot_manager,
                            session_id,
                        );
                        executor.execute(&tc.name, &tc.args, &mut turn_ctx)
                    };

                    emit_event(StreamEvent {
                        r#type: "tool_result".to_string(),
                        mode: None,
                        phase: None,
                        phase_detail: None,
                        text_delta: None,
                        tool_call: None,
                        tool_result: Some(ToolResultPayload {
                            id: tc.id.clone(),
                            name: tc.name.clone(),
                            summary: res.summary.clone(),
                            ok: res.ok,
                            output: Some(res.output.clone()),
                        }),
                        snapshot: None,
                        error: None,
                    });

                    {
                        let store = self.store.lock().map_err(|e| e.to_string())?;
                        let _ = store.append_message(
                            session_id,
                            "tool",
                            &res.output,
                            Some(&tc.name),
                            Some(&tc.id),
                            None,
                        );
                    }

                    llm_messages.push(LlmMessage {
                        role: "tool".to_string(),
                        content: res.output,
                        tool_calls: None,
                        tool_name: Some(tc.name.clone()),
                        tool_call_id: Some(tc.id.clone()),
                    });
                }

                // Continue loop for next step
                continue;
            }

            // No tool calls: final answer
            {
                let store = self.store.lock().map_err(|e| e.to_string())?;
                let _ = store.append_message(session_id, "assistant", &assistant_text, None, None, None);
            }

            // Commit snapshot
            let snap_res = {
                let store = self.store.lock().map_err(|e| e.to_string())?;
                self.snapshot_manager.commit_turn(turn_ctx, &store)
            };

            if let Ok(Some(snap)) = snap_res {
                emit_event(StreamEvent {
                    r#type: "snapshot".to_string(),
                    mode: None,
                    phase: None,
                    phase_detail: None,
                    text_delta: None,
                    tool_call: None,
                    tool_result: None,
                    snapshot: Some(snap),
                    error: None,
                });
            }

            emit_event(StreamEvent {
                r#type: "done".to_string(),
                mode: None,
                phase: None,
                phase_detail: None,
                text_delta: None,
                tool_call: None,
                tool_result: None,
                snapshot: None,
                error: None,
            });

            return Ok(());
        }

        // Reached max steps
        emit_event(StreamEvent {
            r#type: "done".to_string(),
            mode: None,
            phase: None,
            phase_detail: None,
            text_delta: None,
            tool_call: None,
            tool_result: None,
            snapshot: None,
            error: None,
        });

        Ok(())
    }
}
