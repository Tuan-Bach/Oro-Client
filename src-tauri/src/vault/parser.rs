use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarkdownLink {
    pub raw: String,
    pub target: String,
    pub alias: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarkdownHeading {
    pub level: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MarkdownTask {
    pub done: bool,
    pub text: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParsedMarkdown {
    pub title: String,
    pub frontmatter: HashMap<String, serde_json::Value>,
    pub links: Vec<MarkdownLink>,
    pub tags: Vec<String>,
    pub headings: Vec<MarkdownHeading>,
    pub tasks: Vec<MarkdownTask>,
    pub word_count: usize,
}

pub fn parse_markdown(file_path: &str, content: &str) -> ParsedMarkdown {
    let normalized = content.replace("\r\n", "\n");
    let (frontmatter, body, body_start_line) = extract_frontmatter(&normalized);

    let mut links = Vec::new();
    let mut tags_set: BTreeSet<String> = BTreeSet::new();
    let mut headings = Vec::new();
    let mut tasks = Vec::new();

    // Pull frontmatter tags if present
    if let Some(tags_val) = frontmatter.get("tags") {
        match tags_val {
            serde_json::Value::Array(arr) => {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        let clean = s.trim().trim_start_matches('#').to_lowercase();
                        if !clean.is_empty() {
                            tags_set.insert(clean);
                        }
                    }
                }
            }
            serde_json::Value::String(s) => {
                for part in s.split(|c: char| c == ',' || c.is_whitespace()) {
                    let clean = part.trim().trim_start_matches('#').to_lowercase();
                    if !clean.is_empty() {
                        tags_set.insert(clean);
                    }
                }
            }
            _ => {}
        }
    }

    let fence_re = Regex::new(r"^(`{3,}|~{3,})").unwrap();
    let heading_re = Regex::new(r"^(#{1,6})\s+(.+?)\s*#*$").unwrap();
    let task_re = Regex::new(r"^\s*[-*+]\s+\[([ xX])\]\s+(.+)$").unwrap();
    let inline_code_re = Regex::new(r"`[^`]*`").unwrap();
    let link_re = Regex::new(r"\[\[([^\[\]]+)\]\]").unwrap();
    let tag_re = Regex::new(r"(?:^|[\s(])#([a-zA-Z][a-zA-Z0-9_\-/]*)").unwrap();

    let lines: Vec<&str> = body.split('\n').collect();
    let mut in_fence = false;
    let mut fence_char = ' ';

    for (i, &line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Detect code fences
        if let Some(caps) = fence_re.captures(trimmed) {
            let marker = caps.get(1).unwrap().as_str().chars().next().unwrap();
            if !in_fence {
                in_fence = true;
                fence_char = marker;
            } else if marker == fence_char {
                in_fence = false;
                fence_char = ' ';
            }
            continue;
        }

        if in_fence {
            continue;
        }

        // Headings
        if let Some(caps) = heading_re.captures(line) {
            let level = caps.get(1).unwrap().as_str().len();
            let text = caps.get(2).unwrap().as_str().trim().to_string();
            headings.push(MarkdownHeading { level, text });
        }

        // Tasks
        if let Some(caps) = task_re.captures(line) {
            let done = caps.get(1).unwrap().as_str().eq_ignore_ascii_case("x");
            let text = caps.get(2).unwrap().as_str().trim().to_string();
            tasks.push(MarkdownTask {
                done,
                text,
                line: body_start_line + i + 1,
            });
        }

        // Strip inline code spans before matching links and tags
        let without_code = inline_code_re.replace_all(line, "");

        // Wiki-links: [[target]] or [[target|alias]] or [[target#section|alias]]
        for caps in link_re.captures_iter(&without_code) {
            let raw = caps.get(1).unwrap().as_str().trim();
            if raw.is_empty() {
                continue;
            }

            let parts: Vec<&str> = raw.splitn(2, '|').collect();
            let target_and_heading = parts[0].trim();
            let alias = if parts.len() > 1 {
                Some(parts[1].trim().to_string())
            } else {
                None
            };

            let target = target_and_heading.split('#').next().unwrap_or("").trim();
            if target.is_empty() {
                continue;
            }

            links.push(MarkdownLink {
                raw: raw.to_string(),
                target: target.to_string(),
                alias,
            });
        }

        // Inline tags: #tag
        for caps in tag_re.captures_iter(&without_code) {
            let tag = caps.get(1).unwrap().as_str().to_lowercase();
            if !tag.is_empty() {
                tags_set.insert(tag);
            }
        }
    }

    // Derive title: frontmatter.title > first H1 > filename without extension
    let title = if let Some(fm_title) = frontmatter.get("title").and_then(|v| v.as_str()) {
        let t = fm_title.trim();
        if !t.is_empty() {
            t.to_string()
        } else {
            fallback_title(file_path, &headings)
        }
    } else {
        fallback_title(file_path, &headings)
    };

    // Calculate word count
    let code_block_re = Regex::new(r"```[\s\S]*?```").unwrap();
    let text_only = code_block_re.replace_all(&body, " ");
    let word_count = text_only
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .count();

    ParsedMarkdown {
        title,
        frontmatter,
        links,
        tags: tags_set.into_iter().collect(),
        headings,
        tasks,
        word_count,
    }
}

fn fallback_title(file_path: &str, headings: &[MarkdownHeading]) -> String {
    if let Some(h1) = headings.iter().find(|h| h.level == 1) {
        return h1.text.clone();
    }
    Path::new(file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

fn extract_frontmatter(
    content: &str,
) -> (HashMap<String, serde_json::Value>, String, usize) {
    if !content.starts_with("---\n") {
        return (HashMap::new(), content.to_string(), 0);
    }

    let end_idx = match content[4..].find("\n---") {
        Some(idx) => idx + 4,
        None => return (HashMap::new(), content.to_string(), 0),
    };

    let yaml_block = &content[4..end_idx];
    let rest_start = end_idx + 4;
    let body = content[rest_start..].trim_start_matches('\n').to_string();
    let body_start_line = content[..rest_start].split('\n').count();

    let mut frontmatter = HashMap::new();
    let mut current_key: Option<String> = None;
    let mut current_array: Option<Vec<serde_json::Value>> = None;

    let kv_re = Regex::new(r"^([a-zA-Z0-9_-]+)\s*:\s*(.*)$").unwrap();
    let list_re = Regex::new(r"^\s+-\s+(.+)$").unwrap();

    for line in yaml_block.lines() {
        let trimmed_end = line.trim_end();
        let trimmed = trimmed_end.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // List item under current_key
        if let Some(caps) = list_re.captures(trimmed_end)
            && let Some(ref k) = current_key {
                let item = strip_quotes(caps.get(1).unwrap().as_str().trim());
                if current_array.is_none() {
                    current_array = Some(Vec::new());
                }
                current_array.as_mut().unwrap().push(serde_json::Value::String(item));
                frontmatter.insert(k.clone(), serde_json::Value::Array(current_array.clone().unwrap()));
                continue;
            }

        // Key-value pair
        if let Some(caps) = kv_re.captures(trimmed) {
            let key = caps.get(1).unwrap().as_str().to_string();
            current_key = Some(key.clone());
            current_array = None;

            let val = caps.get(2).unwrap().as_str().trim();
            if val.is_empty() {
                current_array = Some(Vec::new());
                frontmatter.insert(key, serde_json::Value::Array(Vec::new()));
            } else if val.starts_with('[') && val.ends_with(']') {
                let inner = &val[1..val.len() - 1];
                let items: Vec<serde_json::Value> = inner
                    .split(',')
                    .map(|s| serde_json::Value::String(strip_quotes(s.trim())))
                    .filter(|v| match v {
                        serde_json::Value::String(s) => !s.is_empty(),
                        _ => true,
                    })
                    .collect();
                frontmatter.insert(key, serde_json::Value::Array(items));
            } else if val == "true" {
                frontmatter.insert(key, serde_json::Value::Bool(true));
            } else if val == "false" {
                frontmatter.insert(key, serde_json::Value::Bool(false));
            } else {
                frontmatter.insert(key, serde_json::Value::String(strip_quotes(val)));
            }
        }
    }

    (frontmatter, body, body_start_line)
}

fn strip_quotes(s: &str) -> String {
    if ((s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')))
        && s.len() >= 2 {
            return s[1..s.len() - 1].to_string();
        }
    s.to_string()
}
