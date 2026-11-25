import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OroStore } from "../db/store.js";
import type { RollbackResult, SnapshotManifestItem, TurnSnapshotRecord } from "../types.js";
import type { VaultFsManager } from "./fs-manager.js";
import type { VaultIndexer } from "./indexer.js";

export interface ActiveTurnContext {
  id: string;
  sessionId: string;
  turnIndex: number;
  userPrompt: string;
  createdAt: string;
  snapshotDir: string;
  recordedPaths: Set<string>;
  manifest: SnapshotManifestItem[];
}

export class VaultSnapshotManager {
  private readonly snapshotsBaseDir: string;

  constructor(
    public readonly workspaceRoot: string,
    private readonly store: OroStore,
    private readonly fsManager: VaultFsManager,
    private readonly indexer: VaultIndexer
  ) {
    this.snapshotsBaseDir = path.join(workspaceRoot, ".oro", "snapshots");
  }

  /**
   * Begins a new lazy snapshot context for an agent turn.
   */
  beginTurn(sessionId: string, userPrompt: string, turnIndex = 1): ActiveTurnContext {
    const id = `turn_snap_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const createdAt = new Date().toISOString();
    const snapshotDir = path.join(this.snapshotsBaseDir, sessionId, id);

    return {
      id,
      sessionId,
      turnIndex,
      userPrompt,
      createdAt,
      snapshotDir,
      recordedPaths: new Set<string>(),
      manifest: [],
    };
  }

  /**
   * Lazily captures the before-mutation state of a file during an active turn.
   * Only the FIRST mutation per file in a single turn is recorded, ensuring
   * the true pre-turn state is preserved.
   */
  recordBeforeMutation(
    context: ActiveTurnContext,
    relPath: string,
    action: "created" | "modified" | "moved" | "deleted",
    originalPath?: string
  ): void {
    const normalizedRel = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (context.recordedPaths.has(normalizedRel)) {
      return; // Already captured original pre-turn state for this path
    }
    context.recordedPaths.add(normalizedRel);

    const sourceRel = (action === "moved" && originalPath ? originalPath : normalizedRel)
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    const absPath = path.resolve(this.workspaceRoot, sourceRel);
    const exists = fs.existsSync(absPath);

    if (exists && !fs.statSync(absPath).isDirectory()) {
      // Backup original file content to .oro/snapshots/<sessionId>/<id>/backup/<sourceRel>
      const backupRel = path.join("backup", sourceRel);
      const backupAbs = path.join(context.snapshotDir, backupRel);
      fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
      fs.copyFileSync(absPath, backupAbs);

      const bytes = fs.statSync(absPath).size;
      context.manifest.push({
        path: normalizedRel,
        originalExists: true,
        action,
        originalPath,
        backupRelPath: backupRel.replace(/\\/g, "/"),
        bytes,
      });
    } else {
      // File did not exist before this turn (e.g. newly created file)
      context.manifest.push({
        path: normalizedRel,
        originalExists: false,
        action: "created",
      });
    }
  }

  /**
   * Commits the snapshot at the end of an agent turn.
   * If files were mutated, records the snapshot in SQLite and prunes old turns.
   * If no files were mutated, cleans up the snapshot folder and returns null.
   */
  commitTurn(context: ActiveTurnContext): TurnSnapshotRecord | null {
    if (context.manifest.length === 0) {
      if (fs.existsSync(context.snapshotDir)) {
        try {
          fs.rmSync(context.snapshotDir, { recursive: true, force: true });
        } catch {}
      }
      return null;
    }

    const record: TurnSnapshotRecord = {
      id: context.id,
      sessionId: context.sessionId,
      turnIndex: context.turnIndex,
      userPrompt: context.userPrompt,
      createdAt: context.createdAt,
      status: "active",
      manifest: context.manifest,
    };

    // Save metadata to SQLite
    this.store.saveTurnSnapshot(record);

    // Prune snapshots older than 15 turns for this session
    const prunedIds = this.store.pruneTurnSnapshots(context.sessionId, 15);
    for (const prunedId of prunedIds) {
      const prunedDir = path.join(this.snapshotsBaseDir, context.sessionId, prunedId);
      if (fs.existsSync(prunedDir)) {
        try {
          fs.rmSync(prunedDir, { recursive: true, force: true });
        } catch {}
      }
    }

    return record;
  }

  /**
   * Restores the workspace to the exact state it was in before this turn executed.
   */
  rollback(snapshotId: string): RollbackResult {
    const snapshot = this.store.getTurnSnapshot(snapshotId);
    if (!snapshot) {
      return {
        success: false,
        snapshotId,
        restoredFiles: [],
        deletedFiles: [],
        error: `Snapshot ${snapshotId} not found`,
      };
    }

    if (snapshot.status === "reverted") {
      return {
        success: false,
        snapshotId,
        restoredFiles: [],
        deletedFiles: [],
        error: `Snapshot ${snapshotId} has already been reverted`,
      };
    }

    const restoredFiles: string[] = [];
    const deletedFiles: string[] = [];
    const snapshotDir = path.join(this.snapshotsBaseDir, snapshot.sessionId, snapshot.id);

    try {
      for (const item of snapshot.manifest) {
        const currentAbs = path.resolve(this.workspaceRoot, item.path);

        // 1. Files created during the turn: remove them
        if (!item.originalExists || item.action === "created") {
          if (fs.existsSync(currentAbs)) {
            this.fsManager.deletePath(item.path);
            deletedFiles.push(item.path);
          }
          continue;
        }

        // 2. Files moved during the turn: move back to original path
        if (item.action === "moved" && item.originalPath) {
          const originalAbs = path.resolve(this.workspaceRoot, item.originalPath);
          if (fs.existsSync(currentAbs) && !fs.existsSync(originalAbs)) {
            this.fsManager.movePath(item.path, item.originalPath);
            restoredFiles.push(item.originalPath);
            continue;
          }
        }

        // 3. Files modified or deleted: restore from backup
        if (item.backupRelPath) {
          const backupAbs = path.join(snapshotDir, item.backupRelPath);
          if (fs.existsSync(backupAbs)) {
            fs.mkdirSync(path.dirname(currentAbs), { recursive: true });
            fs.copyFileSync(backupAbs, currentAbs);
            restoredFiles.push(item.path);

            // Re-index note if indexable
            if (item.path.endsWith(".md") || item.path.endsWith(".txt")) {
              this.indexer.indexFile(item.path);
            }
          }
        }
      }

      // Mark snapshot as reverted in SQLite
      this.store.updateTurnSnapshotStatus(snapshotId, "reverted");

      return {
        success: true,
        snapshotId,
        restoredFiles,
        deletedFiles,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        snapshotId,
        restoredFiles,
        deletedFiles,
        error: `Rollback failed: ${errorMsg}`,
      };
    }
  }

  /**
   * Lists snapshots for a session.
   */
  listSnapshots(sessionId: string, limit = 20): TurnSnapshotRecord[] {
    return this.store.listTurnSnapshots(sessionId, limit);
  }
}
