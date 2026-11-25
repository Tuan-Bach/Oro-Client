import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { OroStore } from "../src/db/store.js";
import { VaultFsManager } from "../src/vault/fs-manager.js";
import { VaultIndexer } from "../src/vault/indexer.js";

describe("VaultFsManager & VaultIndexer", () => {
  it("manages files/folders, refactors [[wiki-links]] on move, blocks path escape, and soft-deletes to trash", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-vault-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);

    try {
      const session = store.createSession({
        title: "Vault Test",
        mode: "organizer",
        provider: "gemini",
        model: "gemini-2.5-flash",
      });

      fsMgr.createFolder("Notes", session.id);
      fsMgr.writeFile("Notes/Idea.md", "# Idea\nInitial idea note.", session.id);
      fsMgr.writeFile("Notes/Hub.md", "# Hub\nSee [[Idea]] for details.", session.id);

      // Verify backlink exists before move
      assert.equal(store.getBacklinks("Notes/Idea.md").length, 1);

      // Move Idea.md -> Projects/GreatIdea.md and verify [[wiki-link]] auto-refactor!
      const moveRes = fsMgr.movePath("Notes/Idea.md", "Projects/GreatIdea.md", session.id);
      assert.deepEqual(moveRes.updatedLinksIn, ["Notes/Hub.md"]);

      const hubContent = fsMgr.readFile("Notes/Hub.md", session.id).content;
      assert.ok(hubContent.includes("[[Projects/GreatIdea]]"), `Expected refactored link, got: ${hubContent}`);

      // Path traversal must throw
      assert.throws(() => fsMgr.resolveSafe("../../etc/passwd"), /escapes workspace root/);

      // Safe delete moves file to .oro/trash/
      const delRes = fsMgr.deletePath("Projects/GreatIdea.md", session.id);
      assert.ok(delRes.trashPath.startsWith(".oro/trash/"));
      assert.equal(fs.existsSync(path.join(tmpDir, "Projects", "GreatIdea.md")), false);
      assert.equal(fs.existsSync(path.join(tmpDir, delRes.trashPath)), true);

      // Session tracked files
      const sessionFiles = store.getSessionFiles(session.id);
      assert.ok(sessionFiles.some((f) => f.path === "Notes/Hub.md"));
      assert.ok(sessionFiles.some((f) => f.path === "Projects/GreatIdea.md" && f.lastAction === "deleted"));
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
