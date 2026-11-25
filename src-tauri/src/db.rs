use chrono::Utc;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoworkerGoal {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String, // "active" | "completed" | "paused" | "failed"
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub token_budget: i64,
    pub tokens_used: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoworkerTask {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub role: String, // "Scout" | "Coder" | "Tester" | "Critic"
    pub model_tier: String, // "fast" | "standard" | "reasoning"
    pub status: String, // "pending" | "in_progress" | "waiting_approval" | "done" | "failed" | "skipped"
    pub dependencies: Vec<String>,
    pub checkpoint_context: Option<String>,
    pub result_summary: Option<String>,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoworkerApproval {
    pub id: String,
    pub task_id: String,
    pub goal_id: String,
    pub action_type: String, // "shell_exec" | "delete_file" | "git_push" | "destructive_edit"
    pub title: String,
    pub payload_json: String,
    pub status: String, // "pending" | "approved" | "rejected"
    pub user_response_note: Option<String>,
    pub created_at: i64,
    pub resolved_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteRecord {
    pub path: String,
    pub title: String,
    pub content: String,
    pub frontmatter_json: String,
    pub mtime_ms: f64,
    pub size_bytes: usize,
    pub word_count: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub mtime_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteLinkRecord {
    pub source_path: String,
    pub target_raw: String,
    pub target_resolved: Option<String>,
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub title: String,
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageRecord {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_args: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFileRecord {
    pub session_id: String,
    pub path: String,
    pub last_action: String,
    pub pinned: bool,
    pub touch_count: i64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryRecord {
    pub id: i64,
    pub category: String,
    pub content: String,
    pub tags: Vec<String>,
    pub importance: i64,
    pub source_session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: i64,
    pub title: String,
    pub done: bool,
    pub file_path: Option<String>,
    pub session_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotManifestItem {
    pub path: String,
    pub original_exists: bool,
    pub action: String,
    pub original_path: Option<String>,
    pub backup_rel_path: Option<String>,
    pub bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSnapshotRecord {
    pub id: String,
    pub session_id: String,
    pub turn_index: i64,
    pub user_prompt: String,
    pub created_at: String,
    pub status: String,
    pub manifest: Vec<SnapshotManifestItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackResult {
    pub success: bool,
    pub snapshot_id: String,
    pub restored_files: Vec<String>,
    pub deleted_files: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorDraftRecord {
    pub path: String,
    pub content: String,
    pub updated_at: String,
}

pub fn build_fts_query(raw: &str) -> Option<String> {
    let tokens: Vec<String> = raw
        .split_whitespace()
        .map(|t| {
            t.chars()
                .filter(|c| !r#""'*^():-+<>"#.contains(*c))
                .collect::<String>()
                .trim()
                .to_string()
        })
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        None
    } else {
        Some(
            tokens
                .into_iter()
                .map(|t| format!("\"{}\"*", t))
                .collect::<Vec<_>>()
                .join(" AND "),
        )
    }
}

pub struct CoworkerStore {
    conn: Connection,
}

impl CoworkerStore {
    pub fn new(conn: Connection) -> Result<Self> {
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    pub fn open(path: &str) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::new(conn)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::new(conn)
    }

    pub fn init_schema(&self) -> Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS coworker_goals (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'active',
                created_at INTEGER NOT NULL,
                completed_at INTEGER,
                token_budget INTEGER DEFAULT 250000,
                tokens_used INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS coworker_tasks (
                id TEXT PRIMARY KEY,
                goal_id TEXT NOT NULL REFERENCES coworker_goals(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'Coder',
                model_tier TEXT NOT NULL DEFAULT 'standard',
                status TEXT NOT NULL DEFAULT 'pending',
                dependencies TEXT NOT NULL DEFAULT '[]',
                checkpoint_context TEXT,
                result_summary TEXT,
                created_at INTEGER NOT NULL,
                started_at INTEGER,
                completed_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS coworker_approvals (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES coworker_tasks(id) ON DELETE CASCADE,
                goal_id TEXT NOT NULL REFERENCES coworker_goals(id) ON DELETE CASCADE,
                action_type TEXT NOT NULL,
                title TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                user_response_note TEXT,
                created_at INTEGER NOT NULL,
                resolved_at INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_coworker_tasks_goal ON coworker_tasks(goal_id);
            CREATE INDEX IF NOT EXISTS idx_coworker_tasks_status ON coworker_tasks(status);
            CREATE INDEX IF NOT EXISTS idx_coworker_approvals_status ON coworker_approvals(status);

            CREATE TABLE IF NOT EXISTS notes (
                path TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                frontmatter_json TEXT NOT NULL DEFAULT '{}',
                mtime_ms REAL NOT NULL DEFAULT 0,
                size_bytes INTEGER NOT NULL DEFAULT 0,
                word_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
                path,
                title,
                content,
                tokenize = 'porter unicode61'
            );

            CREATE TABLE IF NOT EXISTS note_links (
                source_path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
                target_raw TEXT NOT NULL,
                target_resolved TEXT,
                alias TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_path);
            CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_resolved);

            CREATE TABLE IF NOT EXISTS note_tags (
                path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
                tag TEXT NOT NULL,
                PRIMARY KEY (path, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag);

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'assistant',
                provider TEXT NOT NULL DEFAULT 'gemini',
                model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
                summary TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                workspace_root TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_name TEXT,
                tool_call_id TEXT,
                tool_args TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

            CREATE TABLE IF NOT EXISTS session_files (
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                path TEXT NOT NULL,
                last_action TEXT NOT NULL,
                pinned INTEGER NOT NULL DEFAULT 0,
                touch_count INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (session_id, path)
            );
            CREATE INDEX IF NOT EXISTS idx_session_files_session ON session_files(session_id, pinned DESC, updated_at DESC);

            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL DEFAULT 'fact',
                content TEXT NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]',
                importance INTEGER NOT NULL DEFAULT 3,
                source_session_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                workspace_root TEXT NOT NULL DEFAULT ''
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                memory_id UNINDEXED,
                category,
                content,
                tags,
                tokenize = 'porter unicode61'
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                file_path TEXT,
                session_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                workspace_root TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done, created_at DESC);

            CREATE TABLE IF NOT EXISTS turn_snapshots (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                turn_index INTEGER NOT NULL DEFAULT 1,
                user_prompt TEXT NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                manifest_json TEXT NOT NULL DEFAULT '[]'
            );
            CREATE INDEX IF NOT EXISTS idx_turn_snapshots_session ON turn_snapshots(session_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS editor_drafts (
                path TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            "#,
        )?;
        Ok(())
    }

    // --- GOAL OPERATIONS ---

    pub fn create_goal(
        &self,
        title: &str,
        description: Option<&str>,
        token_budget: Option<i64>,
    ) -> Result<CoworkerGoal> {
        let id = format!("goal-{}", Uuid::new_v4().simple());
        let now = Utc::now().timestamp_millis();
        let budget = token_budget.unwrap_or(250_000);

        self.conn.execute(
            r#"
            INSERT INTO coworker_goals (id, title, description, status, created_at, token_budget, tokens_used)
            VALUES (?1, ?2, ?3, 'active', ?4, ?5, 0)
            "#,
            params![id, title, description, now, budget],
        )?;

        Ok(CoworkerGoal {
            id,
            title: title.to_string(),
            description: description.map(String::from),
            status: "active".to_string(),
            created_at: now,
            completed_at: None,
            token_budget: budget,
            tokens_used: 0,
        })
    }

    pub fn get_goal(&self, id: &str) -> Result<Option<CoworkerGoal>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, title, description, status, created_at, completed_at, token_budget, tokens_used
            FROM coworker_goals WHERE id = ?1
            "#,
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(CoworkerGoal {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                completed_at: row.get(5)?,
                token_budget: row.get(6)?,
                tokens_used: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_active_goal(&self) -> Result<Option<CoworkerGoal>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, title, description, status, created_at, completed_at, token_budget, tokens_used
            FROM coworker_goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 1
            "#,
        )?;

        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(Some(CoworkerGoal {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                completed_at: row.get(5)?,
                token_budget: row.get(6)?,
                tokens_used: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_goal_status(&self, id: &str, status: &str) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        let completed_at = if status == "completed" || status == "failed" {
            Some(now)
        } else {
            None
        };

        self.conn.execute(
            r#"
            UPDATE coworker_goals
            SET status = ?1, completed_at = COALESCE(?2, completed_at)
            WHERE id = ?3
            "#,
            params![status, completed_at, id],
        )?;
        Ok(())
    }

    pub fn add_tokens_used(&self, goal_id: &str, tokens: i64) -> Result<()> {
        self.conn.execute(
            r#"
            UPDATE coworker_goals
            SET tokens_used = tokens_used + ?1
            WHERE id = ?2
            "#,
            params![tokens, goal_id],
        )?;
        Ok(())
    }

    // --- TASK OPERATIONS ---

    pub fn create_task(
        &self,
        goal_id: &str,
        title: &str,
        role: &str,
        model_tier: &str,
        dependencies: &[String],
    ) -> Result<CoworkerTask> {
        let id = format!("task-{}", Uuid::new_v4().simple());
        let now = Utc::now().timestamp_millis();
        let deps_json = serde_json::to_string(dependencies).unwrap_or_else(|_| "[]".to_string());

        self.conn.execute(
            r#"
            INSERT INTO coworker_tasks (id, goal_id, title, role, model_tier, status, dependencies, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)
            "#,
            params![id, goal_id, title, role, model_tier, deps_json, now],
        )?;

        Ok(CoworkerTask {
            id,
            goal_id: goal_id.to_string(),
            title: title.to_string(),
            role: role.to_string(),
            model_tier: model_tier.to_string(),
            status: "pending".to_string(),
            dependencies: dependencies.to_vec(),
            checkpoint_context: None,
            result_summary: None,
            created_at: now,
            started_at: None,
            completed_at: None,
        })
    }

    pub fn get_task(&self, id: &str) -> Result<Option<CoworkerTask>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, goal_id, title, role, model_tier, status, dependencies, checkpoint_context, result_summary, created_at, started_at, completed_at
            FROM coworker_tasks WHERE id = ?1
            "#,
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let deps_raw: String = row.get(6)?;
            let deps: Vec<String> = serde_json::from_str(&deps_raw).unwrap_or_default();
            Ok(Some(CoworkerTask {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                role: row.get(3)?,
                model_tier: row.get(4)?,
                status: row.get(5)?,
                dependencies: deps,
                checkpoint_context: row.get(7)?,
                result_summary: row.get(8)?,
                created_at: row.get(9)?,
                started_at: row.get(10)?,
                completed_at: row.get(11)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn update_task_status(
        &self,
        id: &str,
        status: &str,
        result_summary: Option<&str>,
        checkpoint_context: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        let (started_at, completed_at) = match status {
            "in_progress" => (Some(now), None),
            "done" | "failed" | "skipped" => (None, Some(now)),
            _ => (None, None),
        };

        self.conn.execute(
            r#"
            UPDATE coworker_tasks
            SET status = ?1,
                result_summary = COALESCE(?2, result_summary),
                checkpoint_context = COALESCE(?3, checkpoint_context),
                started_at = COALESCE(?4, started_at),
                completed_at = COALESCE(?5, completed_at)
            WHERE id = ?6
            "#,
            params![status, result_summary, checkpoint_context, started_at, completed_at, id],
        )?;
        Ok(())
    }

    pub fn list_tasks(&self, goal_id: &str) -> Result<Vec<CoworkerTask>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, goal_id, title, role, model_tier, status, dependencies, checkpoint_context, result_summary, created_at, started_at, completed_at
            FROM coworker_tasks WHERE goal_id = ?1 ORDER BY created_at ASC
            "#,
        )?;

        let rows = stmt.query_map(params![goal_id], |row| {
            let deps_raw: String = row.get(6)?;
            let deps: Vec<String> = serde_json::from_str(&deps_raw).unwrap_or_default();
            Ok(CoworkerTask {
                id: row.get(0)?,
                goal_id: row.get(1)?,
                title: row.get(2)?,
                role: row.get(3)?,
                model_tier: row.get(4)?,
                status: row.get(5)?,
                dependencies: deps,
                checkpoint_context: row.get(7)?,
                result_summary: row.get(8)?,
                created_at: row.get(9)?,
                started_at: row.get(10)?,
                completed_at: row.get(11)?,
            })
        })?;

        let mut tasks = Vec::new();
        for task in rows {
            tasks.push(task?);
        }
        Ok(tasks)
    }

    // --- APPROVAL OPERATIONS ---

    pub fn create_approval(
        &self,
        task_id: &str,
        goal_id: &str,
        action_type: &str,
        title: &str,
        payload_json: &str,
    ) -> Result<CoworkerApproval> {
        let id = format!("appr-{}", Uuid::new_v4().simple());
        let now = Utc::now().timestamp_millis();

        self.conn.execute(
            r#"
            INSERT INTO coworker_approvals (id, task_id, goal_id, action_type, title, payload_json, status, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)
            "#,
            params![id, task_id, goal_id, action_type, title, payload_json, now],
        )?;

        Ok(CoworkerApproval {
            id,
            task_id: task_id.to_string(),
            goal_id: goal_id.to_string(),
            action_type: action_type.to_string(),
            title: title.to_string(),
            payload_json: payload_json.to_string(),
            status: "pending".to_string(),
            user_response_note: None,
            created_at: now,
            resolved_at: None,
        })
    }

    pub fn get_approval(&self, id: &str) -> Result<Option<CoworkerApproval>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, task_id, goal_id, action_type, title, payload_json, status, user_response_note, created_at, resolved_at
            FROM coworker_approvals WHERE id = ?1
            "#,
        )?;

        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(CoworkerApproval {
                id: row.get(0)?,
                task_id: row.get(1)?,
                goal_id: row.get(2)?,
                action_type: row.get(3)?,
                title: row.get(4)?,
                payload_json: row.get(5)?,
                status: row.get(6)?,
                user_response_note: row.get(7)?,
                created_at: row.get(8)?,
                resolved_at: row.get(9)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn resolve_approval(
        &self,
        id: &str,
        status: &str, // "approved" | "rejected"
        user_response_note: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().timestamp_millis();
        self.conn.execute(
            r#"
            UPDATE coworker_approvals
            SET status = ?1, user_response_note = ?2, resolved_at = ?3
            WHERE id = ?4
            "#,
            params![status, user_response_note, now, id],
        )?;
        Ok(())
    }

    pub fn list_pending_approvals(&self, goal_id: Option<&str>) -> Result<Vec<CoworkerApproval>> {
        let query = match goal_id {
            Some(_) => {
                r#"
                SELECT id, task_id, goal_id, action_type, title, payload_json, status, user_response_note, created_at, resolved_at
                FROM coworker_approvals
                WHERE status = 'pending' AND goal_id = ?1
                ORDER BY created_at ASC
                "#
            }
            None => {
                r#"
                SELECT id, task_id, goal_id, action_type, title, payload_json, status, user_response_note, created_at, resolved_at
                FROM coworker_approvals
                WHERE status = 'pending'
                ORDER BY created_at ASC
                "#
            }
        };

        let mut stmt = self.conn.prepare(query)?;
        let mut approvals = Vec::new();
        if let Some(gid) = goal_id {
            for item in stmt.query_map(params![gid], Self::row_to_approval)? {
                approvals.push(item?);
            }
        } else {
            for item in stmt.query_map([], Self::row_to_approval)? {
                approvals.push(item?);
            }
        }
        Ok(approvals)
    }

    fn row_to_approval(row: &rusqlite::Row) -> rusqlite::Result<CoworkerApproval> {
        Ok(CoworkerApproval {
            id: row.get(0)?,
            task_id: row.get(1)?,
            goal_id: row.get(2)?,
            action_type: row.get(3)?,
            title: row.get(4)?,
            payload_json: row.get(5)?,
            status: row.get(6)?,
            user_response_note: row.get(7)?,
            created_at: row.get(8)?,
            resolved_at: row.get(9)?,
        })
    }

    // --- VAULT OPERATIONS ---

    pub fn upsert_note(
        &self,
        path: &str,
        title: &str,
        content: &str,
        frontmatter_json: &str,
        mtime_ms: f64,
        size_bytes: usize,
        word_count: usize,
        links: &[crate::vault::parser::MarkdownLink],
        tags: &[String],
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();

        self.conn.execute(
            r#"
            INSERT INTO notes (path, title, content, frontmatter_json, mtime_ms, size_bytes, word_count, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(path) DO UPDATE SET
                title = excluded.title,
                content = excluded.content,
                frontmatter_json = excluded.frontmatter_json,
                mtime_ms = excluded.mtime_ms,
                size_bytes = excluded.size_bytes,
                word_count = excluded.word_count,
                updated_at = excluded.updated_at
            "#,
            params![path, title, content, frontmatter_json, mtime_ms, size_bytes as i64, word_count as i64, now],
        )?;

        // FTS index
        self.conn.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])?;
        self.conn.execute(
            "INSERT INTO notes_fts (path, title, content) VALUES (?1, ?2, ?3)",
            params![path, title, content],
        )?;

        // Links
        self.conn.execute("DELETE FROM note_links WHERE source_path = ?1", params![path])?;
        for link in links {
            self.conn.execute(
                "INSERT INTO note_links (source_path, target_raw, target_resolved, alias) VALUES (?1, ?2, NULL, ?3)",
                params![path, link.target, link.alias],
            )?;
        }

        // Tags
        self.conn.execute("DELETE FROM note_tags WHERE path = ?1", params![path])?;
        for tag in tags {
            self.conn.execute(
                "INSERT OR IGNORE INTO note_tags (path, tag) VALUES (?1, ?2)",
                params![path, tag],
            )?;
        }

        Ok(())
    }

    pub fn delete_note(&self, path: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM notes WHERE path = ?1", params![path])?;
        tx.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])?;
        tx.execute("DELETE FROM note_links WHERE source_path = ?1 OR target_resolved = ?1", params![path])?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_notes_with_prefix(&self, prefix: &str) -> Result<()> {
        let clean = prefix.trim_end_matches('/').to_string();
        let pattern = format!("{}/%", clean);
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM notes WHERE path = ?1 OR path LIKE ?2", params![clean, pattern])?;
        tx.execute("DELETE FROM notes_fts WHERE path = ?1 OR path LIKE ?2", params![clean, pattern])?;
        tx.execute(
            "DELETE FROM note_links WHERE source_path = ?1 OR source_path LIKE ?2 OR target_resolved = ?1 OR target_resolved LIKE ?2",
            params![clean, pattern],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_note(&self, path: &str) -> Result<Option<NoteRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT path, title, content, frontmatter_json, mtime_ms, size_bytes, word_count, updated_at
            FROM notes WHERE path = ?1
            "#,
        )?;

        let mut rows = stmt.query(params![path])?;
        if let Some(row) = rows.next()? {
            let size: i64 = row.get(5)?;
            let words: i64 = row.get(6)?;
            Ok(Some(NoteRecord {
                path: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                frontmatter_json: row.get(3)?,
                mtime_ms: row.get(4)?,
                size_bytes: size as usize,
                word_count: words as usize,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_notes_meta(&self) -> Result<Vec<NoteMeta>> {
        let mut stmt = self.conn.prepare("SELECT path, title, mtime_ms FROM notes ORDER BY path ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(NoteMeta {
                path: row.get(0)?,
                title: row.get(1)?,
                mtime_ms: row.get(2)?,
            })
        })?;

        let mut metas = Vec::new();
        for m in rows {
            metas.push(m?);
        }
        Ok(metas)
    }

    pub fn resolve_all_links(&self) -> Result<()> {
        let metas = self.list_notes_meta()?;
        let mut by_exact = std::collections::HashMap::new();
        let mut by_base = std::collections::HashMap::new();
        let mut by_title = std::collections::HashMap::new();

        for m in &metas {
            let lower_path = m.path.to_lowercase();
            by_exact.insert(lower_path.clone(), m.path.clone());
            by_exact.insert(lower_path.trim_end_matches(".md").to_string(), m.path.clone());

            let base = std::path::Path::new(&m.path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            by_base.entry(base).or_insert_with(|| m.path.clone());

            let title_key = m.title.trim().to_lowercase();
            if !title_key.is_empty() {
                by_title.entry(title_key).or_insert_with(|| m.path.clone());
            }
        }

        let mut stmt = self.conn.prepare("SELECT rowid, target_raw FROM note_links")?;
        let rows = stmt.query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            let raw: String = row.get(1)?;
            Ok((rowid, raw))
        })?;

        let mut link_updates = Vec::new();
        for item in rows {
            let (rowid, raw) = item?;
            let key = raw.replace('\\', "/").trim_end_matches(".md").trim().to_lowercase();
            let resolved = by_exact
                .get(&key)
                .or_else(|| by_base.get(&key))
                .or_else(|| by_title.get(&key))
                .cloned();
            link_updates.push((resolved, rowid));
        }

        for (resolved, rowid) in link_updates {
            self.conn.execute(
                "UPDATE note_links SET target_resolved = ?1 WHERE rowid = ?2",
                params![resolved, rowid],
            )?;
        }

        Ok(())
    }

    pub fn get_backlinks(&self, path: &str) -> Result<crate::vault::indexer::BacklinksResult> {
        // Outgoing links
        let mut out_stmt = self.conn.prepare(
            "SELECT target_raw, alias FROM note_links WHERE source_path = ?1"
        )?;
        let outgoing = out_stmt
            .query_map(params![path], |row| {
                let target: String = row.get(0)?;
                let alias: Option<String> = row.get(1)?;
                Ok(crate::vault::parser::MarkdownLink {
                    raw: format!("[[{}]]", target),
                    target,
                    alias,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Incoming backlinks
        let mut in_stmt = self.conn.prepare(
            r#"
            SELECT n.path, n.title, nl.target_raw, nl.alias
            FROM note_links nl
            JOIN notes n ON n.path = nl.source_path
            WHERE nl.target_resolved = ?1
            "#,
        )?;
        let backlinks = in_stmt
            .query_map(params![path], |row| {
                Ok(crate::vault::indexer::BacklinkItem {
                    source_path: row.get(0)?,
                    source_title: row.get(1)?,
                    raw: row.get(2)?,
                    alias: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Tags
        let mut tag_stmt = self.conn.prepare("SELECT tag FROM note_tags WHERE path = ?1 ORDER BY tag ASC")?;
        let tags = tag_stmt
            .query_map(params![path], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;

        Ok(crate::vault::indexer::BacklinksResult {
            outgoing,
            backlinks,
            tags,
        })
    }

    pub fn get_all_links(&self) -> Result<Vec<NoteLinkRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT source_path, target_raw, target_resolved, alias FROM note_links WHERE target_resolved IS NOT NULL"
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(NoteLinkRecord {
                source_path: row.get(0)?,
                target_raw: row.get(1)?,
                target_resolved: row.get(2)?,
                alias: row.get(3)?,
            })
        })?;

        let mut links = Vec::new();
        for item in rows {
            links.push(item?);
        }
        Ok(links)
    }

    pub fn search_vault(&self, query: &str) -> Result<Vec<crate::vault::indexer::SearchHit>> {
        let fts_query = match build_fts_query(query) {
            Some(q) => q,
            None => return Ok(Vec::new()),
        };

        let mut stmt = self.conn.prepare(
            r#"
            SELECT n.path, n.title, snippet(notes_fts, 2, '<b>', '</b>', '...', 24)
            FROM notes_fts
            JOIN notes n ON n.path = notes_fts.path
            WHERE notes_fts MATCH ?1
            ORDER BY rank
            LIMIT 50
            "#,
        )?;

        let rows = stmt.query_map(params![fts_query], |row| {
            Ok(crate::vault::indexer::SearchHit {
                path: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
            })
        })?;

        let mut hits = Vec::new();
        for h in rows {
            hits.push(h?);
        }
        Ok(hits)
    }

    pub fn get_vault_stats(&self) -> Result<crate::vault::indexer::VaultStats> {
        let notes_count: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM notes",
            [],
            |r| r.get(0),
        )?;
        let links_count: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM note_links",
            [],
            |r| r.get(0),
        )?;
        let broken_links_count: usize = self.conn.query_row(
            "SELECT COUNT(*) FROM note_links WHERE target_resolved IS NULL",
            [],
            |r| r.get(0),
        )?;
        let tags_count: usize = self.conn.query_row(
            "SELECT COUNT(DISTINCT tag) FROM note_tags",
            [],
            |r| r.get(0),
        )?;

        Ok(crate::vault::indexer::VaultStats {
            notes_count,
            links_count,
            broken_links_count,
            tags_count,
        })
    }

    pub fn get_knowledge_graph(&self) -> Result<crate::vault::graph::KnowledgeGraph> {
        let metas = self.list_notes_meta()?;
        let node_ids: Vec<String> = metas.iter().map(|m| m.path.clone()).collect();

        let all_links = self.get_all_links()?;
        let edges: Vec<(String, String)> = all_links
            .iter()
            .filter_map(|l| l.target_resolved.as_ref().map(|tgt| (l.source_path.clone(), tgt.clone())))
            .collect();

        let ranks = crate::vault::graph::PageRank::compute(&node_ids, &edges);

        let mut nodes = Vec::new();
        for m in &metas {
            let tags = self.get_note_tags(&m.path)?;
            let link_count = edges.iter().filter(|(s, t)| s == &m.path || t == &m.path).count();
            let rank = ranks.get(&m.path).copied().unwrap_or(0.0);

            nodes.push(crate::vault::graph::GraphNode {
                id: m.path.clone(),
                title: m.title.clone(),
                pagerank: rank,
                link_count,
                tags,
            });
        }

        let graph_edges = edges
            .into_iter()
            .map(|(s, t)| crate::vault::graph::GraphEdge { source: s, target: t })
            .collect();

        Ok(crate::vault::graph::KnowledgeGraph {
            nodes,
            edges: graph_edges,
        })
    }

    // --- SESSIONS & MESSAGES ---

    pub fn create_session(
        &self,
        title: Option<&str>,
        mode: Option<&str>,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> Result<SessionRecord> {
        let id = format!("sess-{}", Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();
        let title_str = title.unwrap_or("New Chat").trim();
        let title_final = if title_str.is_empty() { "New Chat" } else { title_str };
        let mode_str = mode.unwrap_or("assistant");
        let prov_str = provider.unwrap_or("gemini");
        let mod_str = model.unwrap_or("gemini-3.8-flash");

        self.conn.execute(
            r#"
            INSERT INTO sessions (id, title, mode, provider, model, summary, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7)
            "#,
            params![id, title_final, mode_str, prov_str, mod_str, now, now],
        )?;

        Ok(SessionRecord {
            id,
            title: title_final.to_string(),
            mode: mode_str.to_string(),
            provider: prov_str.to_string(),
            model: mod_str.to_string(),
            summary: None,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn get_session(&self, id: &str) -> Result<Option<SessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, mode, provider, model, summary, created_at, updated_at FROM sessions WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(SessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                mode: row.get(2)?,
                provider: row.get(3)?,
                model: row.get(4)?,
                summary: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, mode, provider, model, summary, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                mode: row.get(2)?,
                provider: row.get(3)?,
                model: row.get(4)?,
                summary: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        let mut sessions = Vec::new();
        for s in rows {
            sessions.push(s?);
        }
        Ok(sessions)
    }

    pub fn list_sessions_for_workspace(&self, workspace_root: &str) -> Result<Vec<SessionRecord>> {
        let _ = self.conn.execute("ALTER TABLE sessions ADD COLUMN workspace_root TEXT NOT NULL DEFAULT ''", []);
        let mut stmt = self.conn.prepare(
            "SELECT id, title, mode, provider, model, summary, created_at, updated_at FROM sessions WHERE workspace_root = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(params![workspace_root], |row| {
            Ok(SessionRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                mode: row.get(2)?,
                provider: row.get(3)?,
                model: row.get(4)?,
                summary: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        let mut sessions = Vec::new();
        for s in rows {
            sessions.push(s?);
        }
        Ok(sessions)
    }

    pub fn create_session_for_workspace(
        &self,
        title: Option<&str>,
        mode: Option<&str>,
        provider: Option<&str>,
        model: Option<&str>,
        workspace_root: &str,
    ) -> Result<SessionRecord> {
        let _ = self.conn.execute("ALTER TABLE sessions ADD COLUMN workspace_root TEXT NOT NULL DEFAULT ''", []);
        let rec = self.create_session(title, mode, provider, model)?;
        self.conn.execute(
            "UPDATE sessions SET workspace_root = ?1 WHERE id = ?2",
            params![workspace_root, rec.id],
        )?;
        Ok(rec)
    }

    pub fn update_session(
        &self,
        id: &str,
        title: Option<&str>,
        mode: Option<&str>,
        summary: Option<&str>,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        if let Some(t) = title {
            self.conn.execute(
                "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![t, now, id],
            )?;
        }
        if let Some(m) = mode {
            self.conn.execute(
                "UPDATE sessions SET mode = ?1, updated_at = ?2 WHERE id = ?3",
                params![m, now, id],
            )?;
        }
        if let Some(s) = summary {
            self.conn.execute(
                "UPDATE sessions SET summary = ?1, updated_at = ?2 WHERE id = ?3",
                params![s, now, id],
            )?;
        }
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM messages WHERE session_id = ?1", params![id])?;
        tx.execute("DELETE FROM session_files WHERE session_id = ?1", params![id])?;
        tx.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn delete_messages(&self, ids: &[String]) -> Result<()> {
        if ids.is_empty() {
            return Ok(());
        }
        let tx = self.conn.unchecked_transaction()?;
        for id in ids {
            tx.execute("DELETE FROM messages WHERE id = ?1", params![id])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn append_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        tool_name: Option<&str>,
        tool_call_id: Option<&str>,
        tool_args: Option<&str>,
    ) -> Result<ChatMessageRecord> {
        let id = format!("msg-{}", Uuid::new_v4().simple());
        let now = Utc::now().to_rfc3339();

        self.conn.execute(
            r#"
            INSERT INTO messages (id, session_id, role, content, tool_name, tool_call_id, tool_args, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![id, session_id, role, content, tool_name, tool_call_id, tool_args, now],
        )?;

        self.conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;

        Ok(ChatMessageRecord {
            id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            tool_name: tool_name.map(|s| s.to_string()),
            tool_call_id: tool_call_id.map(|s| s.to_string()),
            tool_args: tool_args.map(|s| s.to_string()),
            created_at: now,
        })
    }

    pub fn list_messages(&self, session_id: &str) -> Result<Vec<ChatMessageRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, session_id, role, content, tool_name, tool_call_id, tool_args, created_at
            FROM messages
            WHERE session_id = ?1
            ORDER BY created_at ASC
            "#,
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            Ok(ChatMessageRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_name: row.get(4)?,
                tool_call_id: row.get(5)?,
                tool_args: row.get(6)?,
                created_at: row.get(7)?,
            })
        })?;
        let mut messages = Vec::new();
        for m in rows {
            messages.push(m?);
        }
        Ok(messages)
    }

    pub fn track_session_file(&self, session_id: &str, path: &str, action: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"
            INSERT INTO session_files (session_id, path, last_action, pinned, touch_count, updated_at)
            VALUES (?1, ?2, ?3, 0, 1, ?4)
            ON CONFLICT (session_id, path) DO UPDATE SET
                last_action = excluded.last_action,
                touch_count = touch_count + 1,
                updated_at = excluded.updated_at
            "#,
            params![session_id, path, action, now],
        )?;
        Ok(())
    }

    pub fn list_session_files(&self, session_id: &str) -> Result<Vec<SessionFileRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT session_id, path, last_action, pinned, touch_count, updated_at
            FROM session_files
            WHERE session_id = ?1
            ORDER BY pinned DESC, updated_at DESC
            "#,
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            let pinned_int: i64 = row.get(3)?;
            Ok(SessionFileRecord {
                session_id: row.get(0)?,
                path: row.get(1)?,
                last_action: row.get(2)?,
                pinned: pinned_int != 0,
                touch_count: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        let mut files = Vec::new();
        for f in rows {
            files.push(f?);
        }
        Ok(files)
    }

    pub fn set_file_pinned(&self, session_id: &str, path: &str, pinned: bool) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let pinned_val = if pinned { 1 } else { 0 };
        self.conn.execute(
            r#"
            INSERT INTO session_files (session_id, path, last_action, pinned, touch_count, updated_at)
            VALUES (?1, ?2, 'pinned', ?3, 1, ?4)
            ON CONFLICT (session_id, path) DO UPDATE SET
                pinned = excluded.pinned,
                updated_at = excluded.updated_at
            "#,
            params![session_id, path, pinned_val, now],
        )?;
        Ok(())
    }

    // --- MEMORIES ---

    pub fn save_memory(
        &self,
        content: &str,
        category: Option<&str>,
        tags: &[String],
        importance: Option<i64>,
        source_session_id: Option<&str>,
    ) -> Result<MemoryRecord> {
        let now = Utc::now().to_rfc3339();
        let cat = category.unwrap_or("fact");
        let imp = importance.unwrap_or(3).clamp(1, 5);
        let tags_json = serde_json::to_string(tags).unwrap_or_else(|_| "[]".to_string());
        let tags_joined = tags.join(" ");

        self.conn.execute(
            r#"
            INSERT INTO memories (category, content, tags_json, importance, source_session_id, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![cat, content, tags_json, imp, source_session_id, now, now],
        )?;

        let mem_id = self.conn.last_insert_rowid();

        let _ = self.conn.execute(
            r#"
            INSERT INTO memories_fts (memory_id, category, content, tags)
            VALUES (?1, ?2, ?3, ?4)
            "#,
            params![mem_id, cat, content, tags_joined],
        );

        Ok(MemoryRecord {
            id: mem_id,
            category: cat.to_string(),
            content: content.to_string(),
            tags: tags.to_vec(),
            importance: imp,
            source_session_id: source_session_id.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_memories(&self, limit: Option<usize>) -> Result<Vec<MemoryRecord>> {
        let lim = limit.unwrap_or(20) as i64;
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, category, content, tags_json, importance, source_session_id, created_at, updated_at
            FROM memories
            ORDER BY importance DESC, updated_at DESC
            LIMIT ?1
            "#,
        )?;
        let rows = stmt.query_map(params![lim], |row| {
            let tags_json_str: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json_str).unwrap_or_default();
            Ok(MemoryRecord {
                id: row.get(0)?,
                category: row.get(1)?,
                content: row.get(2)?,
                tags,
                importance: row.get(4)?,
                source_session_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        let mut list = Vec::new();
        for m in rows {
            list.push(m?);
        }
        Ok(list)
    }

    pub fn search_memories(&self, query: &str, limit: Option<usize>) -> Result<Vec<MemoryRecord>> {
        let q = query.trim();
        if q.is_empty() {
            return self.list_memories(limit);
        }
        let lim = limit.unwrap_or(10) as i64;

        if let Some(fts_expr) = build_fts_query(q) {
            let mut stmt = self.conn.prepare(
                r#"
                SELECT m.id, m.category, m.content, m.tags_json, m.importance, m.source_session_id, m.created_at, m.updated_at
                FROM memories_fts f
                JOIN memories m ON m.id = f.memory_id
                WHERE memories_fts MATCH ?1
                ORDER BY rank
                LIMIT ?2
                "#,
            )?;
            let rows = stmt.query_map(params![fts_expr, lim], |row| {
                let tags_json_str: String = row.get(3)?;
                let tags: Vec<String> = serde_json::from_str(&tags_json_str).unwrap_or_default();
                Ok(MemoryRecord {
                    id: row.get(0)?,
                    category: row.get(1)?,
                    content: row.get(2)?,
                    tags,
                    importance: row.get(4)?,
                    source_session_id: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            });

            if let Ok(mapped) = rows {
                let mut list = Vec::new();
                for item in mapped.flatten() {
                    list.push(item);
                }
                if !list.is_empty() {
                    return Ok(list);
                }
            }
        }

        // Fallback to LIKE substring search
        let like_query = format!("%{}%", q);
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, category, content, tags_json, importance, source_session_id, created_at, updated_at
            FROM memories
            WHERE content LIKE ?1 OR category LIKE ?1
            ORDER BY importance DESC, updated_at DESC
            LIMIT ?2
            "#,
        )?;
        let rows = stmt.query_map(params![like_query, lim], |row| {
            let tags_json_str: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json_str).unwrap_or_default();
            Ok(MemoryRecord {
                id: row.get(0)?,
                category: row.get(1)?,
                content: row.get(2)?,
                tags,
                importance: row.get(4)?,
                source_session_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        let mut list = Vec::new();
        for m in rows {
            list.push(m?);
        }
        Ok(list)
    }

    pub fn delete_memory(&self, id: i64) -> Result<()> {
        let _ = self.conn.execute("DELETE FROM memories_fts WHERE memory_id = ?1", params![id]);
        self.conn.execute("DELETE FROM memories WHERE id = ?1", params![id])?;
        Ok(())
    }

    // --- TASKS ---

    pub fn add_task(&self, title: &str, file_path: Option<&str>, session_id: Option<&str>) -> Result<TaskRecord> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"
            INSERT INTO tasks (title, done, file_path, session_id, created_at, updated_at)
            VALUES (?1, 0, ?2, ?3, ?4, ?5)
            "#,
            params![title, file_path, session_id, now, now],
        )?;
        let id = self.conn.last_insert_rowid();
        Ok(TaskRecord {
            id,
            title: title.to_string(),
            done: false,
            file_path: file_path.map(|s| s.to_string()),
            session_id: session_id.map(|s| s.to_string()),
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn list_tasks_all(&self) -> Result<Vec<TaskRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, title, done, file_path, session_id, created_at, updated_at FROM tasks ORDER BY done ASC, created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            let done_int: i64 = row.get(2)?;
            Ok(TaskRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                done: done_int != 0,
                file_path: row.get(3)?,
                session_id: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        let mut list = Vec::new();
        for t in rows {
            list.push(t?);
        }
        Ok(list)
    }

    pub fn toggle_task(&self, id: i64, done: Option<bool>) -> Result<Option<TaskRecord>> {
        let now = Utc::now().to_rfc3339();
        let target_done = match done {
            Some(d) => d,
            None => {
                let current_done: Option<i64> = self.conn.query_row(
                    "SELECT done FROM tasks WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                ).ok();
                match current_done {
                    Some(cd) => cd == 0,
                    None => return Ok(None),
                }
            }
        };

        self.conn.execute(
            "UPDATE tasks SET done = ?1, updated_at = ?2 WHERE id = ?3",
            params![if target_done { 1 } else { 0 }, now, id],
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT id, title, done, file_path, session_id, created_at, updated_at FROM tasks WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let done_int: i64 = row.get(2)?;
            Ok(Some(TaskRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                done: done_int != 0,
                file_path: row.get(3)?,
                session_id: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn delete_task(&self, id: i64) -> Result<()> {
        self.conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        Ok(())
    }

    // --- TURN SNAPSHOTS ---

    pub fn save_turn_snapshot(&self, snap: &TurnSnapshotRecord) -> Result<()> {
        let manifest_json = serde_json::to_string(&snap.manifest).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            r#"
            INSERT INTO turn_snapshots (id, session_id, turn_index, user_prompt, created_at, status, manifest_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT (id) DO UPDATE SET
                status = excluded.status,
                manifest_json = excluded.manifest_json
            "#,
            params![
                snap.id,
                snap.session_id,
                snap.turn_index,
                snap.user_prompt,
                snap.created_at,
                snap.status,
                manifest_json
            ],
        )?;
        Ok(())
    }

    pub fn get_turn_snapshot(&self, id: &str) -> Result<Option<TurnSnapshotRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, session_id, turn_index, user_prompt, created_at, status, manifest_json FROM turn_snapshots WHERE id = ?1",
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let manifest_str: String = row.get(6)?;
            let manifest: Vec<SnapshotManifestItem> = serde_json::from_str(&manifest_str).unwrap_or_default();
            Ok(Some(TurnSnapshotRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                turn_index: row.get(2)?,
                user_prompt: row.get(3)?,
                created_at: row.get(4)?,
                status: row.get(5)?,
                manifest,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_turn_snapshots(&self, session_id: &str) -> Result<Vec<TurnSnapshotRecord>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, session_id, turn_index, user_prompt, created_at, status, manifest_json
            FROM turn_snapshots
            WHERE session_id = ?1
            ORDER BY created_at DESC
            "#,
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            let manifest_str: String = row.get(6)?;
            let manifest: Vec<SnapshotManifestItem> = serde_json::from_str(&manifest_str).unwrap_or_default();
            Ok(TurnSnapshotRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                turn_index: row.get(2)?,
                user_prompt: row.get(3)?,
                created_at: row.get(4)?,
                status: row.get(5)?,
                manifest,
            })
        })?;
        let mut list = Vec::new();
        for s in rows {
            list.push(s?);
        }
        Ok(list)
    }

    pub fn update_snapshot_status(&self, id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE turn_snapshots SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn prune_turn_snapshots(&self, session_id: &str, keep_count: usize) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT id FROM turn_snapshots WHERE session_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![session_id], |r| r.get::<_, String>(0))?;
        let mut all_ids = Vec::new();
        for r in rows {
            all_ids.push(r?);
        }

        if all_ids.len() <= keep_count {
            return Ok(Vec::new());
        }

        let to_prune = &all_ids[keep_count..];
        for pid in to_prune {
            let _ = self.conn.execute("DELETE FROM turn_snapshots WHERE id = ?1", params![pid]);
        }
        Ok(to_prune.to_vec())
    }

    // --- EDITOR DRAFTS ---

    pub fn save_draft(&self, path: &str, content: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.conn.execute(
            r#"
            INSERT INTO editor_drafts (path, content, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT (path) DO UPDATE SET
                content = excluded.content,
                updated_at = excluded.updated_at
            "#,
            params![path, content, now],
        )?;
        Ok(())
    }

    pub fn get_draft(&self, path: &str) -> Result<Option<EditorDraftRecord>> {
        let mut stmt = self.conn.prepare("SELECT path, content, updated_at FROM editor_drafts WHERE path = ?1")?;
        let mut rows = stmt.query(params![path])?;
        if let Some(row) = rows.next()? {
            Ok(Some(EditorDraftRecord {
                path: row.get(0)?,
                content: row.get(1)?,
                updated_at: row.get(2)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list_drafts(&self) -> Result<Vec<EditorDraftRecord>> {
        let mut stmt = self.conn.prepare("SELECT path, content, updated_at FROM editor_drafts ORDER BY updated_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(EditorDraftRecord {
                path: row.get(0)?,
                content: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        let mut list = Vec::new();
        for d in rows {
            list.push(d?);
        }
        Ok(list)
    }

    pub fn delete_draft(&self, path: &str) -> Result<()> {
        self.conn.execute("DELETE FROM editor_drafts WHERE path = ?1", params![path])?;
        Ok(())
    }

    pub fn clear_all_drafts(&self) -> Result<()> {
        self.conn.execute("DELETE FROM editor_drafts", [])?;
        Ok(())
    }

    pub fn get_note_tags(&self, path: &str) -> Result<Vec<String>> {
        let mut stmt = self.conn.prepare("SELECT tag FROM note_tags WHERE path = ?1")?;
        let rows = stmt.query_map(params![path], |r| r.get(0))?;
        let mut tags = Vec::new();
        for t in rows {
            tags.push(t?);
        }
        Ok(tags)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_store_lifecycle() {
        let store = CoworkerStore::open_in_memory().expect("open memory db");

        // 1. Create Goal
        let goal = store
            .create_goal("Autonomous Leak Fix", Some("Refactor FTS5 memory handling"), Some(100_000))
            .expect("create goal");
        assert_eq!(goal.title, "Autonomous Leak Fix");
        assert_eq!(goal.status, "active");

        let active_goal = store.get_active_goal().expect("get active").expect("should exist");
        assert_eq!(active_goal.id, goal.id);

        // 2. Create Tasks with Dependencies
        let task1 = store
            .create_task(&goal.id, "Audit FTS5 pointers", "Scout", "fast", &[])
            .expect("create task 1");
        assert_eq!(task1.dependencies.len(), 0);

        let task2 = store
            .create_task(
                &goal.id,
                "Patch memory leak",
                "Coder",
                "standard",
                std::slice::from_ref(&task1.id),
            )
            .expect("create task 2");
        assert_eq!(task2.dependencies, vec![task1.id.clone()]);

        let tasks = store.list_tasks(&goal.id).expect("list tasks");
        assert_eq!(tasks.len(), 2);

        // 3. Update Task Status
        store
            .update_task_status(&task1.id, "done", Some("Found 2 leaks in index.c"), None)
            .expect("update task status");
        let fetched_task1 = store.get_task(&task1.id).expect("get task").unwrap();
        assert_eq!(fetched_task1.status, "done");
        assert_eq!(fetched_task1.result_summary.as_deref(), Some("Found 2 leaks in index.c"));

        // 4. Create and Resolve Approval
        let approval = store
            .create_approval(
                &task2.id,
                &goal.id,
                "shell_exec",
                "Run leak regression test",
                r#"{"command":"cargo test"}"#,
            )
            .expect("create approval");
        assert_eq!(approval.status, "pending");

        let pending = store.list_pending_approvals(None).expect("list pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, approval.id);

        store
            .resolve_approval(&approval.id, "approved", Some("Looks safe to run"))
            .expect("resolve approval");

        let pending_after = store.list_pending_approvals(None).expect("list pending after");
        assert_eq!(pending_after.len(), 0);

        let fetched_appr = store.get_approval(&approval.id).expect("get approval").unwrap();
        assert_eq!(fetched_appr.status, "approved");
        assert_eq!(fetched_appr.user_response_note.as_deref(), Some("Looks safe to run"));

        // 5. Update Goal
        store.add_tokens_used(&goal.id, 4500).expect("add tokens");
        let updated_goal = store.get_goal(&goal.id).expect("get goal").unwrap();
        assert_eq!(updated_goal.tokens_used, 4500);

        store.update_goal_status(&goal.id, "completed").expect("complete goal");
        let active_after = store.get_active_goal().expect("get active after");
        assert!(active_after.is_none());
    }
}
