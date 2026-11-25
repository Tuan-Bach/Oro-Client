use std::collections::HashMap;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought_signature: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessage {
    pub role: String, // "user" | "assistant" | "tool" | "system"
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum LlmStreamEvent {
    #[serde(rename = "text")]
    Text { delta: String },
    #[serde(rename = "tool_call")]
    ToolCall { call: ToolCall },
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error { error: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: String, // "gemini" | "openai" | "anthropic" | "ollama"
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            provider: "gemini".to_string(),
            model: "gemini-3.8-flash".to_string(),
            api_key: None,
            base_url: None,
            reasoning_effort: Some("medium".to_string()),
        }
    }
}

pub struct LlmClient {
    http: reqwest::Client,
}

impl Default for LlmClient {
    fn default() -> Self {
        Self::new()
    }
}

impl LlmClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_default(),
        }
    }

    pub async fn stream_chat(
        &self,
        cfg: &ProviderConfig,
        system_prompt: &str,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<LlmStreamEvent>,
    ) -> Result<(), String> {
        match cfg.provider.as_str() {
            "gemini" => self.stream_gemini(cfg, system_prompt, messages, tools, tx).await,
            "openai" => self.stream_openai(cfg, system_prompt, messages, tools, tx).await,
            "anthropic" => self.stream_anthropic(cfg, system_prompt, messages, tools, tx).await,
            "ollama" => self.stream_ollama(cfg, system_prompt, messages, tools, tx).await,
            other => Err(format!("Unsupported provider: {}", other)),
        }
    }

    // ==================== GEMINI STREAMING ====================

    async fn stream_gemini(
        &self,
        cfg: &ProviderConfig,
        system_prompt: &str,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<LlmStreamEvent>,
    ) -> Result<(), String> {
        let api_key = cfg
            .api_key
            .as_deref()
            .or(option_env!("GEMINI_API_KEY"))
            .or(option_env!("GOOGLE_API_KEY"))
            .ok_or_else(|| "Gemini API key not configured. Set GEMINI_API_KEY or configure provider key.".to_string())?;

        let base_url = cfg
            .base_url
            .as_deref()
            .unwrap_or("https://generativelanguage.googleapis.com/v1beta")
            .trim_end_matches('/');

        // Retry on 503/429 and fall back to gemini-flash-lite-latest if primary model is overloaded

        // Build contents
        let mut contents: Vec<Value> = Vec::new();
        for msg in messages {
            match msg.role.as_str() {
                "user" => {
                    if let Some(prev) = contents.last_mut()
                        && prev["role"] == "user"
                            && let Some(parts) = prev["parts"].as_array_mut()
                                && parts.iter().all(|p| p.get("text").is_some()) {
                                    parts.push(json!({ "text": msg.content }));
                                    continue;
                                }
                    contents.push(json!({
                        "role": "user",
                        "parts": [{ "text": msg.content }]
                    }));
                }
                "assistant" => {
                    let mut parts = Vec::new();
                    if !msg.content.is_empty() {
                        parts.push(json!({ "text": msg.content }));
                    }
                    if let Some(ref tcs) = msg.tool_calls {
                        for tc in tcs {
                            parts.push(json!({
                                "functionCall": {
                                    "name": tc.name,
                                    "args": tc.args
                                },
                                "thoughtSignature": tc.thought_signature.as_deref().unwrap_or("skip_thought_signature_validator")
                            }));
                        }
                    }
                    if !parts.is_empty() {
                        contents.push(json!({
                            "role": "model",
                            "parts": parts
                        }));
                    }
                }
                "tool" => {
                    let parsed: Value = serde_json::from_str(&msg.content)
                        .unwrap_or_else(|_| json!({ "output": msg.content }));
                    let response_obj = if parsed.is_object() {
                        parsed
                    } else {
                        json!({ "result": parsed })
                    };

                    let part = json!({
                        "functionResponse": {
                            "name": msg.tool_name.as_deref().unwrap_or("tool"),
                            "response": response_obj
                        }
                    });

                    // If previous content is user with functionResponse parts, merge
                    if let Some(prev) = contents.last_mut()
                        && prev["role"] == "user"
                            && let Some(parts) = prev["parts"].as_array_mut()
                                && parts.iter().all(|p| p.get("functionResponse").is_some()) {
                                    parts.push(part);
                                    continue;
                                }

                    contents.push(json!({
                        "role": "user",
                        "parts": [part]
                    }));
                }
                _ => {}
            }
        }

        let mut body = json!({
            "systemInstruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": contents
        });

        if !tools.is_empty() {
            let func_decls: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters
                    })
                })
                .collect();
            body["tools"] = json!([{ "functionDeclarations": func_decls }]);
        }

        // Generation config / thinking config
        let effort = cfg.reasoning_effort.as_deref().unwrap_or("medium");
        let is_flash = cfg.model.contains("flash") || cfg.model.contains("lite");
        let is_thinking = cfg.model.contains("thinking");
        let is_pro = cfg.model.contains("pro");

        if is_thinking {
            let budget = match effort {
                "low" => 1024,
                "high" => 16384,
                _ => 4096,
            };
            body["generationConfig"] = json!({ "thinkingConfig": { "thinkingBudget": budget } });
        } else if is_pro {
            let budget = match effort {
                "low" => 1024,
                "high" => 8192,
                _ => 2048,
            };
            body["generationConfig"] = json!({ "thinkingConfig": { "thinkingBudget": budget } });
        } else if is_flash {
            if effort == "high" {
                body["generationConfig"] = json!({ "thinkingConfig": { "thinkingBudget": 2048 } });
            } else if cfg.model.starts_with("gemini-2.5") && !cfg.model.contains("lite") {
                body["generationConfig"] = json!({ "thinkingConfig": { "thinkingBudget": 0 } });
            }
        } else if effort == "low" && cfg.model.starts_with("gemini-2.5") {
            body["generationConfig"] = json!({ "thinkingConfig": { "thinkingBudget": 0 } });
        }

        // Retry on 503/429 and fall back to lite models if primary model is overloaded
        let mut models_to_try = vec![cfg.model.clone()];
        for fallback in ["gemini-flash-lite-latest", "gemini-3.5-flash-lite"] {
            if cfg.model != fallback {
                models_to_try.push(fallback.to_string());
            }
        }

        let mut final_resp = None;
        let mut last_err = String::new();

        'outer: for model_name in &models_to_try {
            let attempt_url = format!(
                "{}/models/{}:streamGenerateContent?alt=sse&key={}",
                base_url, model_name, api_key
            );
            for attempt in 0..2 {
                let resp_res = self
                    .http
                    .post(&attempt_url)
                    .timeout(std::time::Duration::from_secs(20))
                    .header(CONTENT_TYPE, "application/json")
                    .json(&body)
                    .send()
                    .await;

                let resp = match resp_res {
                    Ok(r) => r,
                    Err(e) => {
                        let msg = if e.is_timeout() {
                            format!("Gemini request timed out on {}", model_name)
                        } else {
                            format!("Gemini connection error on {}", model_name)
                        };
                        last_err = msg;
                        if attempt == 0 {
                            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                            continue;
                        }
                        break;
                    }
                };

                if resp.status().is_success() {
                    final_resp = Some(resp);
                    break 'outer;
                }

                let status = resp.status();
                let err_body = resp.text().await.unwrap_or_default();
                last_err = format!("Gemini API error ({}): {}", status, &err_body[..err_body.len().min(400)]);

                if status.as_u16() == 503 || status.as_u16() == 429 {
                    if attempt == 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                        continue;
                    }
                    // Move to fallback model on next outer iteration
                    break;
                } else {
                    return Err(last_err);
                }
            }
        }

        let resp = final_resp.ok_or(last_err)?;

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| format!("Stream read error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if !line.starts_with("data:") {
                    continue;
                }
                let payload = line.trim_start_matches("data:").trim();
                if payload.is_empty() || payload == "[DONE]" {
                    continue;
                }

                if let Ok(v) = serde_json::from_str::<Value>(payload)
                    && let Some(candidates) = v["candidates"].as_array()
                        && let Some(candidate) = candidates.first() {
                            let cand_sig = candidate["thoughtSignature"]
                                .as_str()
                                .or_else(|| candidate["thought_signature"].as_str());

                            if let Some(parts) = candidate["content"]["parts"].as_array() {
                                for part in parts {
                                    if let Some(txt) = part["text"].as_str() {
                                        let is_thought = part["thought"].as_bool().unwrap_or(false);
                                        if !is_thought && !txt.is_empty() {
                                            let _ = tx.send(LlmStreamEvent::Text { delta: txt.to_string() }).await;
                                        }
                                    }
                                    if let Some(fc) = part.get("functionCall") {
                                        let fc_name = fc["name"].as_str().unwrap_or_default();
                                        let fc_args = fc["args"].clone();
                                        let sig = part["thoughtSignature"]
                                            .as_str()
                                            .or_else(|| part["thought_signature"].as_str())
                                            .or_else(|| fc["thoughtSignature"].as_str())
                                            .or_else(|| fc["thought_signature"].as_str())
                                            .or(cand_sig)
                                            .map(|s| s.to_string());

                                        if !fc_name.is_empty() {
                                            let tc = ToolCall {
                                                id: format!("gemini_{}", &Uuid::new_v4().simple().to_string()[..8]),
                                                name: fc_name.to_string(),
                                                args: fc_args,
                                                thought_signature: sig,
                                            };
                                            let _ = tx.send(LlmStreamEvent::ToolCall { call: tc }).await;
                                        }
                                    }
                                }
                            }
                        }
            }
        }

        let _ = tx.send(LlmStreamEvent::Done).await;
        Ok(())
    }

    // ==================== OPENAI STREAMING ====================

    async fn stream_openai(
        &self,
        cfg: &ProviderConfig,
        system_prompt: &str,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<LlmStreamEvent>,
    ) -> Result<(), String> {
        let api_key = cfg
            .api_key
            .as_deref()
            .or(option_env!("OPENAI_API_KEY"))
            .ok_or_else(|| "OpenAI API key not configured. Set OPENAI_API_KEY or configure provider key.".to_string())?;

        let base_url = cfg
            .base_url
            .as_deref()
            .unwrap_or("https://api.openai.com/v1")
            .trim_end_matches('/');

        let url = format!("{}/chat/completions", base_url);

        let mut oai_messages = Vec::new();
        oai_messages.push(json!({
            "role": "system",
            "content": system_prompt
        }));

        for msg in messages {
            match msg.role.as_str() {
                "user" => {
                    oai_messages.push(json!({ "role": "user", "content": msg.content }));
                }
                "assistant" => {
                    let mut obj = json!({
                        "role": "assistant",
                        "content": if msg.content.is_empty() { Value::Null } else { Value::String(msg.content.clone()) }
                    });
                    if let Some(ref tcs) = msg.tool_calls {
                        let calls: Vec<Value> = tcs
                            .iter()
                            .map(|tc| {
                                json!({
                                    "id": tc.id,
                                    "type": "function",
                                    "function": {
                                        "name": tc.name,
                                        "arguments": tc.args.to_string()
                                    }
                                })
                            })
                            .collect();
                        obj["tool_calls"] = json!(calls);
                    }
                    oai_messages.push(obj);
                }
                "tool" => {
                    oai_messages.push(json!({
                        "role": "tool",
                        "tool_call_id": msg.tool_call_id.as_deref().unwrap_or("call_default"),
                        "content": msg.content
                    }));
                }
                _ => {}
            }
        }

        let mut body = json!({
            "model": cfg.model,
            "messages": oai_messages,
            "stream": true
        });

        if !tools.is_empty() {
            let oai_tools: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters
                        }
                    })
                })
                .collect();
            body["tools"] = json!(oai_tools);
        }

        if cfg.model.starts_with('o') || cfg.model.contains("reasoning") {
            body["reasoning_effort"] = json!(cfg.reasoning_effort.as_deref().unwrap_or("medium"));
        }

        let resp = self
            .http
            .post(&url)
            .header(AUTHORIZATION, format!("Bearer {}", api_key))
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI connection error: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!("OpenAI API error ({}): {}", status, &err_body[..err_body.len().min(400)]));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        struct PendingTool {
            id: String,
            name: String,
            args_buf: String,
        }
        let mut pending_tools: HashMap<usize, PendingTool> = HashMap::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| format!("Stream read error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if !line.starts_with("data:") {
                    continue;
                }
                let payload = line.trim_start_matches("data:").trim();
                if payload.is_empty() {
                    continue;
                }
                if payload == "[DONE]" {
                    break;
                }

                if let Ok(v) = serde_json::from_str::<Value>(payload)
                    && let Some(choices) = v["choices"].as_array()
                        && let Some(choice) = choices.first() {
                            let delta = &choice["delta"];
                            if let Some(txt) = delta["content"].as_str()
                                && !txt.is_empty() {
                                    let _ = tx.send(LlmStreamEvent::Text { delta: txt.to_string() }).await;
                                }
                            if let Some(tcs) = delta["tool_calls"].as_array() {
                                for tc_obj in tcs {
                                    let idx = tc_obj["index"].as_u64().unwrap_or(0) as usize;
                                    let entry = pending_tools.entry(idx).or_insert_with(|| PendingTool {
                                        id: format!("call_{}", &Uuid::new_v4().simple().to_string()[..8]),
                                        name: String::new(),
                                        args_buf: String::new(),
                                    });

                                    if let Some(id) = tc_obj["id"].as_str()
                                        && !id.is_empty() {
                                            entry.id = id.to_string();
                                        }
                                    if let Some(name) = tc_obj["function"]["name"].as_str()
                                        && !name.is_empty() {
                                            entry.name.push_str(name);
                                        }
                                    if let Some(args_chunk) = tc_obj["function"]["arguments"].as_str() {
                                        entry.args_buf.push_str(args_chunk);
                                    }
                                }
                            }
                        }
            }
        }

        // Flush all accumulated tool calls
        let mut indices: Vec<_> = pending_tools.keys().copied().collect();
        indices.sort_unstable();
        for idx in indices {
            if let Some(pt) = pending_tools.remove(&idx)
                && !pt.name.is_empty() {
                    let parsed_args: Value = serde_json::from_str(&pt.args_buf).unwrap_or(json!({}));
                    let tc = ToolCall {
                        id: pt.id,
                        name: pt.name,
                        args: parsed_args,
                        thought_signature: None,
                    };
                    let _ = tx.send(LlmStreamEvent::ToolCall { call: tc }).await;
                }
        }

        let _ = tx.send(LlmStreamEvent::Done).await;
        Ok(())
    }

    // ==================== ANTHROPIC STREAMING ====================

    async fn stream_anthropic(
        &self,
        cfg: &ProviderConfig,
        system_prompt: &str,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<LlmStreamEvent>,
    ) -> Result<(), String> {
        let api_key = cfg
            .api_key
            .as_deref()
            .or(option_env!("ANTHROPIC_API_KEY"))
            .ok_or_else(|| "Anthropic API key not configured. Set ANTHROPIC_API_KEY or configure provider key.".to_string())?;

        let base_url = cfg
            .base_url
            .as_deref()
            .unwrap_or("https://api.anthropic.com/v1")
            .trim_end_matches('/');

        let url = format!("{}/messages", base_url);

        let mut anthropic_messages = Vec::new();
        for msg in messages {
            match msg.role.as_str() {
                "user" => {
                    anthropic_messages.push(json!({
                        "role": "user",
                        "content": [{ "type": "text", "text": msg.content }]
                    }));
                }
                "assistant" => {
                    let mut blocks = Vec::new();
                    if !msg.content.is_empty() {
                        blocks.push(json!({ "type": "text", "text": msg.content }));
                    }
                    if let Some(ref tcs) = msg.tool_calls {
                        for tc in tcs {
                            blocks.push(json!({
                                "type": "tool_use",
                                "id": tc.id,
                                "name": tc.name,
                                "input": tc.args
                            }));
                        }
                    }
                    if !blocks.is_empty() {
                        anthropic_messages.push(json!({
                            "role": "assistant",
                            "content": blocks
                        }));
                    }
                }
                "tool" => {
                    let block = json!({
                        "type": "tool_result",
                        "tool_use_id": msg.tool_call_id.as_deref().unwrap_or("tool_call"),
                        "content": msg.content
                    });
                    if let Some(prev) = anthropic_messages.last_mut()
                        && prev["role"] == "user"
                            && let Some(arr) = prev["content"].as_array_mut()
                                && arr.iter().all(|b| b["type"] == "tool_result") {
                                    arr.push(block);
                                    continue;
                                }
                    anthropic_messages.push(json!({
                        "role": "user",
                        "content": [block]
                    }));
                }
                _ => {}
            }
        }

        let mut headers = HeaderMap::new();
        let api_key_header = HeaderValue::from_str(api_key.trim())
            .map_err(|_| "Invalid Anthropic API key format (contains unsupported header characters).".to_string())?;
        headers.insert("x-api-key", api_key_header);
        headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));
        headers.insert("anthropic-beta", HeaderValue::from_static("prompt-caching-2024-07-31"));
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

        let mut body = json!({
            "model": cfg.model,
            "max_tokens": 4096,
            "system": [{
                "type": "text",
                "text": system_prompt,
                "cache_control": { "type": "ephemeral" }
            }],
            "messages": anthropic_messages,
            "stream": true
        });

        if !tools.is_empty() {
            let ant_tools: Vec<Value> = tools
                .iter()
                .enumerate()
                .map(|(idx, t)| {
                    let mut obj = json!({
                        "name": t.name,
                        "description": t.description,
                        "input_schema": t.parameters
                    });
                    if idx == tools.len() - 1 {
                        obj["cache_control"] = json!({ "type": "ephemeral" });
                    }
                    obj
                })
                .collect();
            body["tools"] = json!(ant_tools);
        }

        let resp = self
            .http
            .post(&url)
            .headers(headers)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Anthropic connection error: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!("Anthropic API error ({}): {}", status, &err_body[..err_body.len().min(400)]));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        let mut current_tool_id = String::new();
        let mut current_tool_name = String::new();
        let mut current_tool_input = String::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| format!("Stream read error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if !line.starts_with("data:") {
                    continue;
                }
                let payload = line.trim_start_matches("data:").trim();
                if payload.is_empty() {
                    continue;
                }

                if let Ok(v) = serde_json::from_str::<Value>(payload) {
                    let event_type = v["type"].as_str().unwrap_or_default();
                    match event_type {
                        "content_block_start" => {
                            let block = &v["content_block"];
                            if block["type"] == "tool_use" {
                                current_tool_id = block["id"].as_str().unwrap_or_default().to_string();
                                current_tool_name = block["name"].as_str().unwrap_or_default().to_string();
                                current_tool_input.clear();
                            }
                        }
                        "content_block_delta" => {
                            let delta = &v["delta"];
                            if delta["type"] == "text_delta" {
                                if let Some(txt) = delta["text"].as_str() {
                                    let _ = tx.send(LlmStreamEvent::Text { delta: txt.to_string() }).await;
                                }
                            } else if delta["type"] == "input_json_delta"
                                && let Some(chunk) = delta["partial_json"].as_str() {
                                    current_tool_input.push_str(chunk);
                                }
                        }
                        "content_block_stop" => {
                            if !current_tool_name.is_empty() {
                                let parsed: Value = serde_json::from_str(&current_tool_input).unwrap_or(json!({}));
                                let tc = ToolCall {
                                    id: current_tool_id.clone(),
                                    name: current_tool_name.clone(),
                                    args: parsed,
                                    thought_signature: None,
                                };
                                let _ = tx.send(LlmStreamEvent::ToolCall { call: tc }).await;
                                current_tool_name.clear();
                                current_tool_input.clear();
                            }
                        }
                        "message_stop" => break,
                        _ => {}
                    }
                }
            }
        }

        let _ = tx.send(LlmStreamEvent::Done).await;
        Ok(())
    }

    // ==================== OLLAMA STREAMING ====================

    async fn stream_ollama(
        &self,
        cfg: &ProviderConfig,
        system_prompt: &str,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
        tx: tokio::sync::mpsc::Sender<LlmStreamEvent>,
    ) -> Result<(), String> {
        let base_url = cfg
            .base_url
            .as_deref()
            .unwrap_or("http://localhost:11434")
            .trim_end_matches('/');

        let url = format!("{}/api/chat", base_url);

        let mut ollama_messages = Vec::new();
        ollama_messages.push(json!({
            "role": "system",
            "content": system_prompt
        }));

        for msg in messages {
            match msg.role.as_str() {
                "user" => {
                    ollama_messages.push(json!({ "role": "user", "content": msg.content }));
                }
                "assistant" => {
                    let mut obj = json!({
                        "role": "assistant",
                        "content": msg.content
                    });
                    if let Some(ref tcs) = msg.tool_calls {
                        let calls: Vec<Value> = tcs
                            .iter()
                            .map(|tc| {
                                json!({
                                    "function": {
                                        "name": tc.name,
                                        "arguments": tc.args
                                    }
                                })
                            })
                            .collect();
                        obj["tool_calls"] = json!(calls);
                    }
                    ollama_messages.push(obj);
                }
                "tool" => {
                    ollama_messages.push(json!({ "role": "tool", "content": msg.content }));
                }
                _ => {}
            }
        }

        let mut body = json!({
            "model": cfg.model,
            "messages": ollama_messages,
            "stream": true
        });

        if !tools.is_empty() {
            let ol_tools: Vec<Value> = tools
                .iter()
                .map(|t| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters
                        }
                    })
                })
                .collect();
            body["tools"] = json!(ol_tools);
        }

        let resp = self
            .http
            .post(&url)
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama connection error: Could not reach {}. {}", base_url, e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama API error ({}): {}", status, &err_body[..err_body.len().min(400)]));
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res.map_err(|e| format!("Stream read error: {}", e))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer.drain(..=pos);

                if line.is_empty() {
                    continue;
                }

                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    if let Some(msg) = v.get("message") {
                        if let Some(txt) = msg["content"].as_str()
                            && !txt.is_empty() {
                                let _ = tx.send(LlmStreamEvent::Text { delta: txt.to_string() }).await;
                            }
                        if let Some(tcs) = msg["tool_calls"].as_array() {
                            for tc_obj in tcs {
                                let fn_obj = &tc_obj["function"];
                                let name = fn_obj["name"].as_str().unwrap_or_default();
                                let args = fn_obj["arguments"].clone();
                                if !name.is_empty() {
                                    let tc = ToolCall {
                                        id: format!("ollama_{}", &Uuid::new_v4().simple().to_string()[..8]),
                                        name: name.to_string(),
                                        args,
                                        thought_signature: None,
                                    };
                                    let _ = tx.send(LlmStreamEvent::ToolCall { call: tc }).await;
                                }
                            }
                        }
                    }
                    if v["done"].as_bool().unwrap_or(false) {
                        break;
                    }
                }
            }
        }

        let _ = tx.send(LlmStreamEvent::Done).await;
        Ok(())
    }
}
