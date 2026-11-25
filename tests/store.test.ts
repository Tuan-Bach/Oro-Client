import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OroStore } from "../src/db/store.js";

describe("OroStore (node:sqlite + FTS5)", () => {
  it("indexes notes, resolves backlinks, and runs FTS5 full-text search", () => {
    const store = new OroStore(":memory:");
    try {
      store.upsertNote({
        path: "Notes/Alpha.md",
        title: "Alpha Plan",
        content: "Alpha links to [[Beta]] for quantum search architecture.",
        frontmatterJson: "{}",
        mtimeMs: 1000,
        sizeBytes: 60,
        wordCount: 9,
        links: [{ raw: "Beta", target: "Beta", alias: null }],
        tags: ["planning", "alpha"],
      });

      store.upsertNote({
        path: "Projects/Beta.md",
        title: "Beta Engine",
        content: "Beta implements fast SQLite FTS5 indexing.",
        frontmatterJson: "{}",
        mtimeMs: 1000,
        sizeBytes: 45,
        wordCount: 6,
        links: [{ raw: "MissingNote", target: "MissingNote", alias: null }],
        tags: ["engine"],
      });

      store.resolveAllLinks();

      const backlinks = store.getBacklinks("Projects/Beta.md");
      assert.equal(backlinks.length, 1);
      assert.equal(backlinks[0]?.sourcePath, "Notes/Alpha.md");

      const hits = store.searchNotes("quantum architecture");
      assert.equal(hits.length, 1);
      assert.equal(hits[0]?.path, "Notes/Alpha.md");

      const stats = store.getVaultStats();
      assert.equal(stats.notes, 2);
      assert.equal(stats.links, 2);
      assert.equal(stats.brokenLinks, 1);
    } finally {
      store.close();
    }
  });

  it("tracks session files, pins, persistent memories, and tasks", () => {
    const store = new OroStore(":memory:");
    try {
      const s = store.createSession({
        title: "Build Oro",
        mode: "builder",
        provider: "gemini",
        model: "gemini-2.5-flash",
      });

      store.trackSessionFile(s.id, "src/app.ts", "created");
      store.trackSessionFile(s.id, "src/app.ts", "modified");
      store.setFilePinned(s.id, "src/app.ts", true);

      const files = store.getSessionFiles(s.id);
      assert.equal(files.length, 1);
      assert.equal(files[0]?.pinned, true);
      assert.equal(files[0]?.touchCount, 2);
      assert.equal(files[0]?.lastAction, "modified");

      store.saveMemory({
        category: "preference",
        content: "User prefers dark gold terminal themes and fast native tools",
        tags: ["ui", "theme"],
        importance: 5,
        sourceSessionId: s.id,
      });

      const memHits = store.searchMemories("gold terminal");
      assert.equal(memHits.length, 1);
      assert.equal(memHits[0]?.importance, 5);

      const t = store.addTask({ title: "Ship v0.1", sessionId: s.id });
      assert.equal(t.done, false);
      const toggled = store.toggleTask(t.id);
      assert.equal(toggled?.done, true);
    } finally {
      store.close();
    }
  });

  it("persists editor drafts for crash recovery and clears on save/discard", () => {
    const store = new OroStore(":memory:");
    try {
      // 1. Save draft for file being edited
      store.saveEditorDraft("Notes/NeuralNetworks.md", "# Unsaved Changes in Draft\nTyped content...");
      store.saveEditorDraft("Notes/GraphMath.md", "# Unsaved Graph Math Note");

      // 2. List drafts
      const drafts = store.listEditorDrafts();
      assert.equal(drafts.length, 2);
      assert.equal(drafts.some((d) => d.path === "Notes/NeuralNetworks.md"), true);

      // 3. Update existing draft (upsert)
      store.saveEditorDraft("Notes/NeuralNetworks.md", "# More updates in draft...");
      const single = store.getEditorDraft("Notes/NeuralNetworks.md");
      assert.ok(single?.content.includes("More updates in draft"));

      // 4. Delete single draft on file save
      store.deleteEditorDraft("Notes/NeuralNetworks.md");
      assert.equal(store.getEditorDraft("Notes/NeuralNetworks.md"), null);
      assert.equal(store.listEditorDrafts().length, 1);

      // 5. Clear all drafts
      store.clearAllEditorDrafts();
      assert.equal(store.listEditorDrafts().length, 0);
    } finally {
      store.close();
    }
  });
});
