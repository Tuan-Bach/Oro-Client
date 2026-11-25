use crate::agent::provider::LlmMessage;
use crate::db::ChatMessageRecord;

const KEEP_RECENT_VERBATIM: usize = 6;
const OLD_TOOL_OUTPUT_LIMIT: usize = 400;

/// Automatically trims bulky older tool outputs and collapses very old turns
/// when a session approaches the character/token budget, while keeping the
/// most recent turns verbatim.
pub fn compact_for_context(mut messages: Vec<LlmMessage>, max_chars: usize) -> Vec<LlmMessage> {
    if messages.len() <= KEEP_RECENT_VERBATIM {
        return messages;
    }

    let cutoff = messages.len().saturating_sub(KEEP_RECENT_VERBATIM);

    // 1. Shrink verbose older tool outputs first (zero-cost win)
    for msg in messages.iter_mut().take(cutoff) {
        if msg.role == "tool" && msg.content.len() > OLD_TOOL_OUTPUT_LIMIT {
            let safe_end = msg
                .content
                .char_indices()
                .take_while(|(i, _)| *i < OLD_TOOL_OUTPUT_LIMIT)
                .last()
                .map(|(i, ch)| i + ch.len_utf8())
                .unwrap_or(0);
            msg.content = format!(
                "{}...\n[compacted {} chars of earlier tool output]",
                &msg.content[..safe_end],
                msg.content.len().saturating_sub(safe_end)
            );
        }
    }

    let total_chars: usize = messages.iter().map(|m| m.content.len()).sum();
    if total_chars <= max_chars {
        return messages;
    }

    // 2. Collapse oldest turns into a concise rolling digest until within budget
    let tail = messages.split_off(cutoff);
    let mut digest_lines = Vec::new();
    let mut digest_chars = 0usize;
    const MAX_DIGEST_CHARS: usize = 4_000;

    for m in &messages {
        if m.role == "tool" {
            continue;
        }
        let snippet: String = m.content.chars().take(180).collect();
        let line = format!("- {}: {}", m.role, snippet.replace('\n', " "));
        if digest_chars + line.len() > MAX_DIGEST_CHARS {
            break;
        }
        digest_chars += line.len();
        digest_lines.push(line);
    }

    let mut result = Vec::with_capacity(tail.len() + 2);
    if !digest_lines.is_empty() {
        result.push(LlmMessage {
            role: "user".to_string(),
            content: format!(
                "[Earlier conversation compacted automatically to stay within context budget]\n{}",
                digest_lines.join("\n")
            ),
            tool_calls: None,
            tool_name: None,
            tool_call_id: None,
        });
        result.push(LlmMessage {
            role: "assistant".to_string(),
            content: "Understood, continuing with that context.".to_string(),
            tool_calls: None,
            tool_name: None,
            tool_call_id: None,
        });
    }
    result.extend(tail);
    result
}

/// Builds a focused prompt asking the active model to summarize the session.
pub fn build_compaction_prompt(messages: &[ChatMessageRecord], focus: Option<&str>) -> String {
    let mut transcript = String::new();
    for m in messages {
        let preview: String = if m.role == "tool" {
            m.content.chars().take(300).collect()
        } else {
            m.content.chars().take(1500).collect()
        };
        transcript.push_str(&format!("[{}]: {}\n\n", m.role.to_uppercase(), preview));
    }

    let focus_clause = match focus.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(f) => format!("\nPay special attention to: {}\n", f),
        None => String::new(),
    };

    format!(
        "Summarize the following conversation into a concise, structured handoff so we can continue seamlessly with a fresh context window.{}\nInclude:\n1. **Goal & Decisions** — what we are building and key decisions made\n2. **Files & Changes** — exact file paths created/modified\n3. **Current State & Next Steps** — what is done and what remains\n\nKeep it tight and factual (under 350 words).\n\n--- TRANSCRIPT ---\n{}",
        focus_clause, transcript
    )
}

pub fn build_local_fallback_summary(messages: &[ChatMessageRecord]) -> String {
    let user_turns: Vec<String> = messages
        .iter()
        .filter(|m| m.role == "user")
        .map(|m| {
            let s: String = m.content.chars().take(140).collect();
            format!("- {}", s.replace('\n', " "))
        })
        .collect();
    format!(
        "Compacted {} earlier messages. Key user requests:\n{}",
        messages.len(),
        user_turns.join("\n")
    )
}
