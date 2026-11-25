use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    ".oro",
    "node_modules",
    "dist",
    "dist-test",
    "build",
    ".next",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
    "target",
    ".trash",
    ".gemini",
    ".vscode",
    ".idea",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String, // posix rel path
    #[serde(rename = "type")]
    pub node_type: String, // "file" | "directory"
    pub extension: Option<String>,
    pub children: Option<Vec<TreeNode>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadFileResult {
    pub path: String,
    pub content: String,
    pub total_lines: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileResult {
    pub path: String,
    pub action: String, // "created" | "modified"
    pub bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    pub from: String,
    pub to: String,
    pub updated_links_in: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum VaultFsError {
    #[error("Path traversal outside workspace root rejected: '{0}'")]
    PathEscape(String),
    #[error("File not found: '{0}'")]
    NotFound(String),
    #[error("Target already exists: '{0}'")]
    AlreadyExists(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

pub struct VaultFs;

impl VaultFs {
    /// Validates and resolves a relative path against workspace root, preventing directory traversal attacks.
    pub fn resolve_safe_path(workspace_root: &Path, rel_path: &str) -> Result<PathBuf, VaultFsError> {
        let clean = rel_path.replace('\\', "/");
        let clean_trimmed = clean.trim_start_matches('/');

        // Reject paths containing '..'
        for segment in clean_trimmed.split('/') {
            if segment == ".." {
                return Err(VaultFsError::PathEscape(rel_path.to_string()));
            }
        }

        let abs = workspace_root.join(clean_trimmed);
        Ok(abs)
    }

    pub fn to_posix_rel(workspace_root: &Path, abs: &Path) -> String {
        let rel = abs.strip_prefix(workspace_root).unwrap_or(abs);
        rel.to_string_lossy().replace('\\', "/")
    }

    /// Recursively returns the file/folder tree of the workspace, sorted with directories first.
    pub fn get_tree(workspace_root: &Path, sub_path: Option<&str>) -> Result<Vec<TreeNode>, VaultFsError> {
        let target_dir = match sub_path {
            Some(p) if !p.trim().is_empty() => Self::resolve_safe_path(workspace_root, p)?,
            _ => workspace_root.to_path_buf(),
        };

        if !target_dir.exists() {
            return Err(VaultFsError::NotFound(target_dir.to_string_lossy().to_string()));
        }

        Self::read_dir_tree(workspace_root, &target_dir)
    }

    fn read_dir_tree(workspace_root: &Path, dir: &Path) -> Result<Vec<TreeNode>, VaultFsError> {
        let mut entries = Vec::new();
        let read_dir = match fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return Ok(entries),
        };

        let ignored: HashSet<&str> = IGNORED_DIRS.iter().copied().collect();

        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if ignored.contains(name.as_str()) {
                continue;
            }

            let path = entry.path();
            let rel_posix = Self::to_posix_rel(workspace_root, &path);

            if path.is_dir() {
                let children = Self::read_dir_tree(workspace_root, &path)?;
                entries.push(TreeNode {
                    name,
                    path: rel_posix,
                    node_type: "directory".to_string(),
                    extension: None,
                    children: Some(children),
                });
            } else if path.is_file() {
                let ext = path.extension().map(|e| e.to_string_lossy().to_string());
                entries.push(TreeNode {
                    name,
                    path: rel_posix,
                    node_type: "file".to_string(),
                    extension: ext,
                    children: None,
                });
            }
        }

        // Sort: directories first, then alphabetical
        entries.sort_by(|a, b| {
            if a.node_type == b.node_type {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            } else if a.node_type == "directory" {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            }
        });

        Ok(entries)
    }

    pub fn read_file(workspace_root: &Path, rel_path: &str) -> Result<ReadFileResult, VaultFsError> {
        let abs = Self::resolve_safe_path(workspace_root, rel_path)?;
        if !abs.exists() {
            return Err(VaultFsError::NotFound(rel_path.to_string()));
        }

        let content = fs::read_to_string(&abs)?;
        let total_lines = content.lines().count().max(1);

        Ok(ReadFileResult {
            path: rel_path.to_string(),
            content,
            total_lines,
        })
    }

    pub fn write_file(
        workspace_root: &Path,
        rel_path: &str,
        content: &str,
    ) -> Result<WriteFileResult, VaultFsError> {
        let abs = Self::resolve_safe_path(workspace_root, rel_path)?;
        let action = if abs.exists() { "modified" } else { "created" };

        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(&abs, content)?;

        Ok(WriteFileResult {
            path: rel_path.to_string(),
            action: action.to_string(),
            bytes: content.len(),
        })
    }

    pub fn create_folder(workspace_root: &Path, rel_path: &str) -> Result<(), VaultFsError> {
        let abs = Self::resolve_safe_path(workspace_root, rel_path)?;
        fs::create_dir_all(abs)?;
        Ok(())
    }

    /// Soft-deletes a file or directory into `.trash/<timestamp>_<filename>`.
    pub fn delete_path(workspace_root: &Path, rel_path: &str) -> Result<String, VaultFsError> {
        let abs = Self::resolve_safe_path(workspace_root, rel_path)?;
        if !abs.exists() {
            return Err(VaultFsError::NotFound(rel_path.to_string()));
        }

        let trash_dir = workspace_root.join(".trash");
        fs::create_dir_all(&trash_dir)?;

        let filename = abs.file_name().unwrap_or_default().to_string_lossy();
        let timestamp = chrono::Utc::now().timestamp_millis();
        let trash_name = format!("{}_{}", timestamp, filename);
        let trash_target = trash_dir.join(&trash_name);

        fs::rename(&abs, &trash_target)?;
        Ok(format!(".trash/{}", trash_name))
    }

    /// Moves/renames a path and automatically refactors [[wiki-links]] in all markdown files if a note was renamed.
    pub fn move_path(
        workspace_root: &Path,
        from_rel: &str,
        to_rel: &str,
    ) -> Result<MoveResult, VaultFsError> {
        let from_abs = Self::resolve_safe_path(workspace_root, from_rel)?;
        let to_abs = Self::resolve_safe_path(workspace_root, to_rel)?;

        if !from_abs.exists() {
            return Err(VaultFsError::NotFound(from_rel.to_string()));
        }
        if to_abs.exists() {
            return Err(VaultFsError::AlreadyExists(to_rel.to_string()));
        }

        if let Some(parent) = to_abs.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::rename(&from_abs, &to_abs)?;

        // If a markdown file was moved, refactor [[wiki-links]] across the vault
        let old_stem = Path::new(from_rel).file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let new_stem = Path::new(to_rel).file_stem().and_then(|s| s.to_str()).unwrap_or("");

        let mut updated_links_in = Vec::new();

        if !old_stem.is_empty() && !new_stem.is_empty() && old_stem != new_stem {
            let md_files = Self::find_all_markdown_files(workspace_root)?;
            for md_path in md_files {
                if let Ok(content) = fs::read_to_string(&md_path) {
                    let (refactored, changed) = Self::refactor_wiki_links(&content, old_stem, new_stem);
                    if changed {
                        let _ = fs::write(&md_path, refactored);
                        updated_links_in.push(Self::to_posix_rel(workspace_root, &md_path));
                    }
                }
            }
        }

        Ok(MoveResult {
            from: from_rel.to_string(),
            to: to_rel.to_string(),
            updated_links_in,
        })
    }

    pub fn find_all_markdown_files(workspace_root: &Path) -> Result<Vec<PathBuf>, VaultFsError> {
        let mut results = Vec::new();
        Self::walk_markdown_files(workspace_root, workspace_root, &mut results)?;
        Ok(results)
    }

    fn walk_markdown_files(
        workspace_root: &Path,
        dir: &Path,
        results: &mut Vec<PathBuf>,
    ) -> Result<(), VaultFsError> {
        let ignored: HashSet<&str> = IGNORED_DIRS.iter().copied().collect();
        let read_dir = match fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(_) => return Ok(()),
        };

        for entry in read_dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if ignored.contains(name.as_str()) {
                continue;
            }

            let path = entry.path();
            if path.is_dir() {
                Self::walk_markdown_files(workspace_root, &path, results)?;
            } else if path.is_file()
                && let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ext_str == "md" || ext_str == "markdown" || ext_str == "mdx" {
                        results.push(path);
                    }
                }
        }
        Ok(())
    }

    /// Replaces [[old_stem]] with [[new_stem]], [[old_stem|alias]] with [[new_stem|alias]],
    /// and [[old_stem#section]] with [[new_stem#section]].
    pub fn refactor_wiki_links(content: &str, old_stem: &str, new_stem: &str) -> (String, bool) {
        let mut changed = false;
        let mut result = String::with_capacity(content.len());
        let mut cursor = 0;

        let link_re = regex::Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap();

        for caps in link_re.captures_iter(content) {
            let mat = caps.get(0).unwrap();
            result.push_str(&content[cursor..mat.start()]);

            let inner = caps.get(1).unwrap().as_str();
            let parts: Vec<&str> = inner.splitn(2, '|').collect();
            let target_and_hash = parts[0].trim();
            let alias = if parts.len() > 1 { Some(parts[1]) } else { None };

            let subparts: Vec<&str> = target_and_hash.splitn(2, '#').collect();
            let target = subparts[0].trim();
            let section = if subparts.len() > 1 { Some(subparts[1]) } else { None };

            if target.eq_ignore_ascii_case(old_stem) {
                changed = true;
                result.push_str("[[");
                result.push_str(new_stem);
                if let Some(sec) = section {
                    result.push('#');
                    result.push_str(sec);
                }
                if let Some(al) = alias {
                    result.push('|');
                    result.push_str(al);
                }
                result.push_str("]]");
            } else {
                result.push_str(mat.as_str());
            }

            cursor = mat.end();
        }

        result.push_str(&content[cursor..]);
        (result, changed)
    }
}
