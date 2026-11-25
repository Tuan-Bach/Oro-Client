use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use chrono::Utc;
use uuid::Uuid;
use crate::db::{CoworkerStore, RollbackResult, SnapshotManifestItem, TurnSnapshotRecord};

#[derive(Debug, Clone)]
pub struct ActiveTurnContext {
    pub id: String,
    pub session_id: String,
    pub turn_index: i64,
    pub user_prompt: String,
    pub created_at: String,
    pub snapshot_dir: PathBuf,
    pub recorded_paths: HashSet<String>,
    pub manifest: Vec<SnapshotManifestItem>,
}

#[derive(Debug, Clone)]
pub struct SnapshotManager {
    pub workspace_root: PathBuf,
    pub snapshots_base_dir: PathBuf,
}

impl SnapshotManager {
    pub fn new<P: AsRef<Path>>(workspace_root: P) -> Self {
        let root = workspace_root.as_ref().to_path_buf();
        let base = root.join(".oro").join("snapshots");
        Self {
            workspace_root: root,
            snapshots_base_dir: base,
        }
    }

    pub fn begin_turn(&self, session_id: &str, user_prompt: &str, turn_index: i64) -> ActiveTurnContext {
        let id = format!(
            "turn_snap_{}_{}",
            Utc::now().timestamp_millis(),
            &Uuid::new_v4().simple().to_string()[..6]
        );
        let created_at = Utc::now().to_rfc3339();
        let snapshot_dir = self.snapshots_base_dir.join(session_id).join(&id);

        ActiveTurnContext {
            id,
            session_id: session_id.to_string(),
            turn_index,
            user_prompt: user_prompt.to_string(),
            created_at,
            snapshot_dir,
            recorded_paths: HashSet::new(),
            manifest: Vec::new(),
        }
    }

    pub fn record_before_mutation(
        &self,
        ctx: &mut ActiveTurnContext,
        rel_path: &str,
        action: &str,
        original_path: Option<&str>,
    ) {
        let normalized = rel_path.replace('\\', "/").trim_start_matches('/').to_string();
        if ctx.recorded_paths.contains(&normalized) {
            return; // Already captured original pre-turn state
        }
        ctx.recorded_paths.insert(normalized.clone());

        let source_rel = if action == "moved" {
            if let Some(orig) = original_path {
                orig.replace('\\', "/").trim_start_matches('/').to_string()
            } else {
                normalized.clone()
            }
        } else {
            normalized.clone()
        };

        let abs_path = self.workspace_root.join(&source_rel);
        if abs_path.exists() && !abs_path.is_dir() {
            let backup_rel = format!("backup/{}", source_rel);
            let backup_abs = ctx.snapshot_dir.join(&backup_rel);
            if let Some(parent) = backup_abs.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(bytes) = fs::copy(&abs_path, &backup_abs) {
                ctx.manifest.push(SnapshotManifestItem {
                    path: normalized,
                    original_exists: true,
                    action: action.to_string(),
                    original_path: original_path.map(|s| s.to_string()),
                    backup_rel_path: Some(backup_rel),
                    bytes: Some(bytes),
                });
                return;
            }
        }

        // File did not exist before this turn (e.g. newly created file)
        ctx.manifest.push(SnapshotManifestItem {
            path: normalized,
            original_exists: false,
            action: "created".to_string(),
            original_path: None,
            backup_rel_path: None,
            bytes: None,
        });
    }

    pub fn commit_turn(
        &self,
        ctx: ActiveTurnContext,
        store: &CoworkerStore,
    ) -> Result<Option<TurnSnapshotRecord>, String> {
        if ctx.manifest.is_empty() {
            if ctx.snapshot_dir.exists() {
                let _ = fs::remove_dir_all(&ctx.snapshot_dir);
            }
            return Ok(None);
        }

        let record = TurnSnapshotRecord {
            id: ctx.id.clone(),
            session_id: ctx.session_id.clone(),
            turn_index: ctx.turn_index,
            user_prompt: ctx.user_prompt.clone(),
            created_at: ctx.created_at.clone(),
            status: "active".to_string(),
            manifest: ctx.manifest,
        };

        store.save_turn_snapshot(&record).map_err(|e| e.to_string())?;

        // Prune snapshots older than 15 turns
        if let Ok(pruned_ids) = store.prune_turn_snapshots(&ctx.session_id, 15) {
            for pruned_id in pruned_ids {
                let pruned_dir = self.snapshots_base_dir.join(&ctx.session_id).join(&pruned_id);
                if pruned_dir.exists() {
                    let _ = fs::remove_dir_all(&pruned_dir);
                }
            }
        }

        Ok(Some(record))
    }

    pub fn rollback(&self, snapshot_id: &str, store: &CoworkerStore) -> Result<RollbackResult, String> {
        let snapshot = store
            .get_turn_snapshot(snapshot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Snapshot {} not found", snapshot_id))?;

        if snapshot.status == "reverted" {
            return Ok(RollbackResult {
                success: false,
                snapshot_id: snapshot_id.to_string(),
                restored_files: Vec::new(),
                deleted_files: Vec::new(),
                error: Some(format!("Snapshot {} has already been reverted", snapshot_id)),
            });
        }

        let mut restored_files = Vec::new();
        let mut deleted_files = Vec::new();
        let snapshot_dir = self.snapshots_base_dir.join(&snapshot.session_id).join(&snapshot.id);

        for item in &snapshot.manifest {
            let current_abs = self.workspace_root.join(&item.path);

            // 1. Files created during the turn: remove them
            if !item.original_exists || item.action == "created" {
                if current_abs.exists() {
                    let _ = fs::remove_file(&current_abs);
                    deleted_files.push(item.path.clone());
                }
                continue;
            }

            // 2. Files moved during the turn: move back to original path
            if item.action == "moved"
                && let Some(ref orig) = item.original_path {
                    let original_abs = self.workspace_root.join(orig);
                    if current_abs.exists() && !original_abs.exists() {
                        if let Some(parent) = original_abs.parent() {
                            let _ = fs::create_dir_all(parent);
                        }
                        if fs::rename(&current_abs, &original_abs).is_ok() {
                            restored_files.push(orig.clone());
                            continue;
                        }
                    }
                }

            // 3. Files modified or deleted: restore from backup
            if let Some(ref backup_rel) = item.backup_rel_path {
                let backup_abs = snapshot_dir.join(backup_rel);
                if backup_abs.exists() {
                    if let Some(parent) = current_abs.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::copy(&backup_abs, &current_abs).is_ok() {
                        restored_files.push(item.path.clone());
                    }
                }
            }
        }

        let _ = store.update_snapshot_status(snapshot_id, "reverted");

        Ok(RollbackResult {
            success: true,
            snapshot_id: snapshot_id.to_string(),
            restored_files,
            deleted_files,
            error: None,
        })
    }
}
