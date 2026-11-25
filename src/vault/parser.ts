import path from "node:path";
import type { ParsedMarkdown } from "../types.js";

/**
 * Lightweight, zero-dependency Obsidian-compatible Markdown parser.
 * Parses YAML frontmatter, [[wiki-links]], #tags, headings, and checkboxes
 * while skipping fenced code blocks and inline code spans.
 */
export function parseMarkdown(filePath: string, content: string): ParsedMarkdown {
  const normalized = content.replace(/\r\n/g, "\n");
  const { frontmatter, body, bodyStartLine } = extractFrontmatter(normalized);

  const links: ParsedMarkdown["links"] = [];
  const tagsSet = new Set<string>();
  const headings: ParsedMarkdown["headings"] = [];
  const tasks: ParsedMarkdown["tasks"] = [];

  // Pull frontmatter tags if present
  if (Array.isArray(frontmatter.tags)) {
    for (const t of frontmatter.tags) {
      if (typeof t === "string" && t.trim()) {
        tagsSet.add(t.trim().replace(/^#/, "").toLowerCase());
      }
    }
  } else if (typeof frontmatter.tags === "string") {
    for (const part of frontmatter.tags.split(/[,\s]+/)) {
      const clean = part.trim().replace(/^#/, "").toLowerCase();
      if (clean) tagsSet.add(clean);
    }
  }

  const lines = body.split("\n");
  let inFence = false;
  let fenceChar = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Detect fenced code blocks ``` or ~~~
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!;
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) continue;

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      headings.push({
        level: headingMatch[1]!.length,
        text: headingMatch[2]!.trim(),
      });
    }

    // Markdown tasks: - [ ] or * [x]
    const taskMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      tasks.push({
        done: taskMatch[1]!.toLowerCase() === "x",
        text: taskMatch[2]!.trim(),
        line: bodyStartLine + i + 1,
      });
    }

    // Strip inline code spans before matching links/tags
    const withoutCode = line.replace(/`[^`]*`/g, "");

    // Wiki-links: [[target]] or [[target|alias]] or [[target#section|alias]]
    const linkRe = /\[\[([^\[\]]+)\]\]/g;
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(withoutCode)) !== null) {
      const raw = m[1]!.trim();
      if (!raw) continue;
      const [targetAndHeading, aliasPart] = raw.split("|");
      const target = (targetAndHeading ?? "").split("#")[0]!.trim();
      if (!target) continue;
      links.push({
        raw,
        target,
        alias: aliasPart ? aliasPart.trim() : null,
      });
    }

    // Inline #tags (preceded by start of line or whitespace, not hex colors or headings)
    const tagRe = /(?:^|[\s(])#([a-zA-Z][a-zA-Z0-9_\-/]*)/g;
    while ((m = tagRe.exec(withoutCode)) !== null) {
      const tag = m[1]!.toLowerCase();
      if (tag) tagsSet.add(tag);
    }
  }

  // Derive title: frontmatter.title > first H1 > filename without extension
  let title = "";
  if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
    title = frontmatter.title.trim();
  } else {
    const h1 = headings.find((h) => h.level === 1);
    if (h1) {
      title = h1.text;
    } else {
      title = path.posix.basename(filePath.replace(/\\/g, "/"), path.posix.extname(filePath));
    }
  }

  const wordCount = body
    .replace(/```[\s\S]*?```/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return {
    title,
    frontmatter,
    links,
    tags: Array.from(tagsSet).sort(),
    headings,
    tasks,
    wordCount,
  };
}

function extractFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  bodyStartLine: number;
} {
  if (!content.startsWith("---\n")) {
    return { frontmatter: {}, body: content, bodyStartLine: 0 };
  }
  const endIdx = content.indexOf("\n---", 4);
  if (endIdx === -1) {
    return { frontmatter: {}, body: content, bodyStartLine: 0 };
  }
  const yamlBlock = content.slice(4, endIdx);
  const restStart = endIdx + 4;
  const body = content.slice(restStart).replace(/^\n/, "");
  const bodyStartLine = content.slice(0, restStart).split("\n").length;

  const frontmatter: Record<string, unknown> = {};
  const lines = yamlBlock.split("\n");
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // YAML list item under currentKey
    const listItem = line.match(/^\s+-\s+(.+)$/);
    if (listItem && currentKey) {
      if (!currentArray) {
        currentArray = [];
        frontmatter[currentKey] = currentArray;
      }
      currentArray.push(stripQuotes(listItem[1]!.trim()));
      continue;
    }

    const kv = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (kv) {
      currentKey = kv[1]!;
      currentArray = null;
      const val = kv[2]!.trim();
      if (!val) {
        frontmatter[currentKey] = [];
        currentArray = frontmatter[currentKey] as string[];
      } else if (val.startsWith("[") && val.endsWith("]")) {
        frontmatter[currentKey] = val
          .slice(1, -1)
          .split(",")
          .map((s) => stripQuotes(s.trim()))
          .filter(Boolean);
      } else if (val === "true" || val === "false") {
        frontmatter[currentKey] = val === "true";
      } else {
        frontmatter[currentKey] = stripQuotes(val);
      }
    }
  }

  return { frontmatter, body, bodyStartLine };
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
