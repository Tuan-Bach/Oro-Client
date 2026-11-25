import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { OroStore } from "../src/db/store.js";
import { VaultFsManager } from "../src/vault/fs-manager.js";
import { VaultIndexer } from "../src/vault/indexer.js";
import { VaultSnapshotManager } from "../src/vault/snapshot-manager.js";

describe("VaultSnapshotManager (Per-Turn Workspace Snapshot & Rollback)", () => {
  it("captures zero-token pre-mutation snapshots and rolls back edits, creates, moves, and deletes", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-snap-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);
    const snapMgr = new VaultSnapshotManager(tmpDir, store, fsMgr, indexer);

    try {
      const session = store.createSession({
        title: "Snapshot Test Session",
        mode: "builder",
        provider: "gemini",
        model: "gemini-3.5-flash",
      });

      // 1. Initial workspace state before agent runs
      fsMgr.writeFile("Notes/Original.md", "# Original Content\nLine 1\nLine 2");
      fsMgr.writeFile("Notes/ToMove.md", "# Move Me Note");
      fsMgr.writeFile("Notes/ToDelete.md", "# Delete Me Note");

      // Verify files exist
      assert.equal(fsMgr.readFile("Notes/Original.md").content.includes("Original Content"), true);

      // 2. Start Turn 1
      const turn1 = snapMgr.beginTurn(session.id, "Refactor notes and create summary", 1);
      fsMgr.onBeforeMutation = (relPath, action, originalPath) => {
        snapMgr.recordBeforeMutation(turn1, relPath, action, originalPath);
      };

      // Agent performs actions:
      // a) Edits Original.md
      fsMgr.writeFile("Notes/Original.md", "# Modified Content by Agent\nNew line added.");
      // b) Creates new file Summary.md
      fsMgr.writeFile("Notes/Summary.md", "# AI Summary\nCreated in turn 1.");
      // c) Moves ToMove.md -> Archive/Moved.md
      fsMgr.movePath("Notes/ToMove.md", "Archive/Moved.md");
      // d) Deletes ToDelete.md
      fsMgr.deletePath("Notes/ToDelete.md");

      // Agent turn finishes: commit snapshot
      fsMgr.onBeforeMutation = undefined;
      const snapshot1 = snapMgr.commitTurn(turn1);
      assert.ok(snapshot1, "Snapshot 1 should have been committed");
      assert.equal(snapshot1.status, "active");
      assert.equal(snapshot1.manifest.length, 4);

      // Verify intermediate state
      assert.equal(fsMgr.readFile("Notes/Original.md").content.includes("Modified Content by Agent"), true);
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes/Summary.md")), true);
      assert.equal(fs.existsSync(path.join(tmpDir, "Archive/Moved.md")), true);
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes/ToMove.md")), false);
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes/ToDelete.md")), false);

      // Verify snapshot is in DB
      const dbSnapshots = snapMgr.listSnapshots(session.id);
      assert.equal(dbSnapshots.length, 1);
      assert.equal(dbSnapshots[0].id, snapshot1.id);

      // 3. Rollback Turn 1
      const rollbackResult = snapMgr.rollback(snapshot1.id);
      assert.equal(rollbackResult.success, true);
      assert.equal(rollbackResult.error, undefined);

      // Verify all files restored to exact pre-turn bytes:
      // a) Original.md is restored
      const restoredOriginal = fsMgr.readFile("Notes/Original.md").content;
      assert.equal(restoredOriginal.includes("Original Content"), true);
      assert.equal(restoredOriginal.includes("Modified Content by Agent"), false);

      // b) Summary.md created in turn 1 is removed
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes/Summary.md")), false);

      // c) Archive/Moved.md is moved back to Notes/ToMove.md
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes/ToMove.md")), true);
      assert.equal(fs.existsSync(path.join(tmpDir, "Archive/Moved.md")), false);

      // d) Notes/ToDelete.md is restored from backup
      assert.equal(fs.existsSync(path.join(tmpDir, "Notes/ToDelete.md")), true);
      assert.equal(fsMgr.readFile("Notes/ToDelete.md").content.includes("Delete Me Note"), true);

      // 4. Verify snapshot status is now 'reverted' and cannot be re-reverted
      const updatedSnap = store.getTurnSnapshot(snapshot1.id);
      assert.equal(updatedSnap?.status, "reverted");

      const doubleRollback = snapMgr.rollback(snapshot1.id);
      assert.equal(doubleRollback.success, false);
      assert.ok(doubleRollback.error?.includes("already been reverted"));
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("prunes old snapshots exceeding retention limit (max 15)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oro-prune-test-"));
    const store = new OroStore(path.join(tmpDir, ".oro", "oro.db"));
    const indexer = new VaultIndexer(tmpDir, store);
    const fsMgr = new VaultFsManager(tmpDir, store, indexer);
    const snapMgr = new VaultSnapshotManager(tmpDir, store, fsMgr, indexer);

    try {
      const session = store.createSession({
        title: "Prune Test Session",
        mode: "plan",
        provider: "gemini",
        model: "gemini-3.5-flash",
      });

      // Generate 18 turns with mutations
      for (let i = 1; i <= 18; i++) {
        const turn = snapMgr.beginTurn(session.id, `Turn prompt ${i}`, i);
        fsMgr.onBeforeMutation = (relPath, action, orig) => {
          snapMgr.recordBeforeMutation(turn, relPath, action, orig);
        };
        fsMgr.writeFile("Note.md", `# Version ${i}`);
        fsMgr.onBeforeMutation = undefined;
        snapMgr.commitTurn(turn);
      }

      const activeSnaps = snapMgr.listSnapshots(session.id);
      assert.equal(activeSnaps.length, 15, `Expected exactly 15 snapshots after pruning, got ${activeSnaps.length}`);
    } finally {
      store.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
