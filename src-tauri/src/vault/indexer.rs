use std::collections::HashSet;
use std::path::Path;
use crate::vault::fs::VaultFs;
use crate::vault::parser::parse_markdown;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VaultStats {
    pub notes_count: usize,
    pub links_count: usize,
    pub broken_links_count: usize,
    pub tags_count: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BacklinksResult {
    pub outgoing: Vec<crate::vault::parser::MarkdownLink>,
    pub backlinks: Vec<BacklinkItem>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BacklinkItem {
    pub source_path: String,
    pub source_title: String,
    pub raw: String,
    pub alias: Option<String>,
}

pub struct VaultIndexer;

impl VaultIndexer {
    /// Fast incremental scan: indexes only new or modified Markdown files into SQLite,
    /// removes deleted notes from SQLite, and resolves [[wiki-links]] when changes occur.
    pub fn index_all(
        workspace_root: &Path,
        store: &crate::db::CoworkerStore,
    ) -> Result<VaultStats, Box<dyn std::error::Error>> {
        let md_files = VaultFs::find_all_markdown_files(workspace_root)?;
        let mut found_paths = HashSet::new();

        // Query existing notes metadata from SQLite to skip unchanged files
        let existing = store.list_notes_meta()?;
        let existing_map: std::collections::HashMap<String, f64> = existing
            .into_iter()
            .map(|n| (n.path, n.mtime_ms))
            .collect();
        let mut has_mutations = false;

        for file_path in md_files {
            let rel_posix = VaultFs::to_posix_rel(workspace_root, &file_path);
            found_paths.insert(rel_posix.clone());

            let metadata = match std::fs::metadata(&file_path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let mtime_ms = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);

            // Fast skip: if already indexed and mtime has not changed, don't read or re-parse
            if let Some(&saved_mtime) = existing_map.get(&rel_posix) {
                if (saved_mtime - mtime_ms).abs() < 1.0 {
                    continue;
                }
            }

            has_mutations = true;
            if let Ok(content) = std::fs::read_to_string(&file_path) {
                let parsed = parse_markdown(&rel_posix, &content);
                let frontmatter_json = serde_json::to_string(&parsed.frontmatter).unwrap_or_else(|_| "{}".to_string());

                store.upsert_note(
                    &rel_posix,
                    &parsed.title,
                    &content,
                    &frontmatter_json,
                    mtime_ms,
                    metadata.len() as usize,
                    parsed.word_count,
                    &parsed.links,
                    &parsed.tags,
                )?;
            }
        }

        // Clean up deleted notes
        for (old_path, _) in &existing_map {
            if !found_paths.contains(old_path) {
                has_mutations = true;
                store.delete_note(old_path)?;
            }
        }

        // Only re-resolve links and recalculate graph if files were modified or deleted
        if has_mutations {
            store.resolve_all_links()?;
        }

        // Return updated stats
        let stats = store.get_vault_stats()?;
        Ok(stats)
    }
}
