import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMarkdown } from "../src/vault/parser.js";

describe("parseMarkdown", () => {
  it("extracts frontmatter, wiki-links, tags, headings, and tasks while ignoring code blocks", () => {
    const md = `---
title: "Second Brain Architecture"
tags: [Architecture, PKM]
status: active
---

# Heading Ignored Because Frontmatter Title Wins

Working on [[Projects/Oro|Oro App]] and [[Notes/SQLite#fts5]].
Inline #typescript and #second-brain tags.

- [ ] Build split-pane TUI
- [x] Add SQLite FTS5 indexing

\`\`\`ts
// Should NOT be parsed as links or tags:
const fake = "[[NotALink]] #notatag";
\`\`\`

Also ignore inline \`[[InlineIgnored]] #inlineignored\`.
`;

    const parsed = parseMarkdown("Notes/Arch.md", md);
    assert.equal(parsed.title, "Second Brain Architecture");
    assert.equal(parsed.frontmatter.status, "active");
    assert.deepEqual(
      parsed.links.map((l) => ({ target: l.target, alias: l.alias })),
      [
        { target: "Projects/Oro", alias: "Oro App" },
        { target: "Notes/SQLite", alias: null },
      ]
    );
    assert.deepEqual(parsed.tags, ["architecture", "pkm", "second-brain", "typescript"]);
    assert.equal(parsed.headings.length, 1);
    assert.equal(parsed.tasks.length, 2);
    assert.equal(parsed.tasks[0]?.done, false);
    assert.equal(parsed.tasks[1]?.done, true);
    assert.ok(parsed.wordCount > 15);
  });

  it("falls back to H1 then filename for title", () => {
    const p1 = parseMarkdown("Inbox/raw.md", "# My Custom H1\nHello world");
    assert.equal(p1.title, "My Custom H1");

    const p2 = parseMarkdown("Inbox/raw-note.md", "Just plain text without heading");
    assert.equal(p2.title, "raw-note");
  });
});
