/**
 * Session Naming Utilities
 * Provides concise, readable placeholder names for new sessions
 * and intelligent, lightning-fast heuristic title generation from user prompts.
 */

/**
 * Detects if a session title is a default/system placeholder title
 * that should be replaced once the user sends their first message.
 */
export function isDefaultSessionTitle(title: string | null | undefined): boolean {
  if (!title || !title.trim()) return true;
  const t = title.trim();
  if (/^(new chat|new session|main workspace|untitled)(\s+\d+)?$/i.test(t)) return true;
  // Old style: "Session 2026-11-23 (a1b2)" or "Session 1"
  if (/^session(\s+\d{4}-\d{2}-\d{2}|\s+\d+)/i.test(t)) return true;
  return false;
}

/**
 * Generates an initial short placeholder title for a newly created session.
 * e.g., "New Chat" or "New Chat 2" if "New Chat" is already taken.
 */
export function generateNewSessionTitle(existingSessions?: Array<{ title: string }>): string {
  if (!existingSessions || existingSessions.length === 0) return "New Chat";
  const titles = new Set(existingSessions.map((s) => s.title.trim().toLowerCase()));
  if (!titles.has("new chat")) return "New Chat";
  let count = 2;
  while (titles.has(`new chat ${count}`)) {
    count++;
  }
  return `New Chat ${count}`;
}

/**
 * Intelligent, lightning-fast heuristic title generator.
 * Converts a raw user prompt into a punchy, clean 2-4 word topic title (max 26 chars).
 */
export function generateShortSessionTitle(rawPrompt: string, maxWords = 4, maxChars = 26): string {
  if (!rawPrompt || !rawPrompt.trim()) return "New Chat";

  // 1. Strip markdown code fences (```...```) or inline code blocks (`...`)
  let clean = rawPrompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, " ");

  // 2. Pick first non-empty line
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let line = lines[0] || clean;

  // 3. Strip leading bullet points, numbers, quotes, or dashes
  line = line.replace(/^[-*•\d.)>\s#]+/, "").trim();

  // 4. Strip conversational filler and command prefixes (case-insensitive)
  const fillerPrefixes = [
    /^(can you\s+(please\s+)?(help me\s+)?(to\s+)?)/i,
    /^(could you\s+(please\s+)?(help me\s+)?(to\s+)?)/i,
    /^(would you\s+(please\s+)?)/i,
    /^(please\s+(help me\s+)?)/i,
    /^(kindly\s+)/i,
    /^(help me\s+(with\s+|to\s+)?)/i,
    /^(i\s+(want|need|would like)\s+(you\s+)?to\s+)/i,
    /^(how\s+(do\s+i|can\s+i|to|can\s+we)\s+)/i,
    /^(what\s+(is|are|about)\s+)/i,
    /^(why\s+(is|are|does|do)\s+)/i,
    /^(tell\s+me\s+(about\s+)?)/i,
    /^(show\s+me\s+)/i,
    /^(explain\s+(to\s+me\s+)?(how\s+)?)/i,
    /^(write\s+(a|an|me\s+a)?\s+)/i,
    /^(create\s+(a|an)?\s+)/i,
    /^(build\s+(a|an)?\s+)/i,
    /^(implement\s+(a|an)?\s+)/i,
    /^(fix\s+(the|a|an)?\s+)/i,
    /^(debug\s+(the|a|an)?\s+)/i,
    /^(make\s+(the|a|an)?\s+)/i,
    /^(add\s+(a|an|the)?\s+)/i,
    /^(find\s+(the|all)?\s+)/i,
    /^(review\s+(and\s+)?)/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const rx of fillerPrefixes) {
      if (rx.test(line)) {
        line = line.replace(rx, "").trim();
        changed = true;
      }
    }
  }

  // 5. Strip trailing punctuation
  line = line.replace(/[?!.:;,—–\-_]+$/, "").trim();

  // 6. Split into words
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "New Chat";

  // Filter out leading articles if present
  if (["the", "a", "an", "this", "that", "these", "those"].includes(words[0]!.toLowerCase()) && words.length > 1) {
    words.shift();
  }

  // 7. Pick up to maxWords
  const selectedWords = words.slice(0, maxWords);

  // 8. Capitalize appropriately (Title Case, preserve acronyms like API, CSS, HTML, OCR, FPGA, UI)
  const acronyms = new Set(["API", "CSS", "HTML", "JSON", "CLI", "UI", "AST", "OCR", "FPGA", "FTS5", "IPC", "SSE", "URL", "PR", "LLM", "AI", "REST"]);
  const capitalizeSegment = (segment: string): string => {
    const upper = segment.toUpperCase();
    if (acronyms.has(upper)) return upper;
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  };

  const formattedWords = selectedWords.map((w, idx) => {
    const lower = w.toLowerCase();
    if (idx > 0 && ["and", "or", "in", "on", "at", "to", "for", "with", "by", "of"].includes(lower)) {
      return lower;
    }
    if (w.includes("-")) {
      return w.split("-").map(capitalizeSegment).join("-");
    }
    return capitalizeSegment(w);
  });

  if (formattedWords.length > 0) {
    formattedWords[0] = formattedWords[0]!.charAt(0).toUpperCase() + formattedWords[0]!.slice(1);
  }

  // Strip trailing dangling prepositions, conjunctions, or articles
  const trailingNoise = new Set(["and", "or", "in", "on", "at", "to", "for", "with", "by", "of", "the", "a", "an"]);
  while (formattedWords.length > 1 && trailingNoise.has(formattedWords[formattedWords.length - 1]!.toLowerCase())) {
    formattedWords.pop();
  }

  let result = formattedWords.join(" ");

  // 9. Cap length at maxChars without chopping mid-word
  if (result.length > maxChars) {
    const truncated = result.slice(0, maxChars);
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > 8) {
      result = truncated.slice(0, lastSpace);
    } else {
      result = truncated;
    }
  }

  return result.trim() || "New Chat";
}
