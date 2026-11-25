import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { OroStore } from "./db/store.js";
import { VaultFsManager } from "./vault/fs-manager.js";
import { VaultIndexer } from "./vault/indexer.js";
import { VaultSnapshotManager } from "./vault/snapshot-manager.js";
import { runAutomatedDiagnostics } from "./agent/orchestrator.js";

export interface BenchmarkTaskResult {
  id: number;
  name: string;
  description: string;
  passed: boolean;
  durationMs: number;
  steps: number;
  error?: string;
}

export interface BenchmarkReport {
  tasks: BenchmarkTaskResult[];
  totalDurationMs: number;
  passedCount: number;
  totalCount: number;
  successRate: number;
}

/**
 * Creates an isolated temporary workspace for testing/benchmarks.
 */
function createTempWorkspace(): string {
  const dir = path.join(os.tmpdir(), `oro-bench-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, ".oro"), { recursive: true });
  return dir;
}

/**
 * Clean up temporary workspace directory.
 */
function cleanupWorkspace(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

/**
 * Executes the standard battery of 5 Second Brain benchmark tasks.
 */
export async function runSecondBrainBenchmarks(customWorkspace?: string): Promise<BenchmarkReport> {
  const isCustom = Boolean(customWorkspace);
  const benchDir = customWorkspace ? path.resolve(customWorkspace) : createTempWorkspace();
  const tasks: BenchmarkTaskResult[] = [];
  const startAll = performance.now();

  try {
    const dbPath = path.join(benchDir, ".oro", "bench.db");
    const store = new OroStore(dbPath);
    const indexer = new VaultIndexer(benchDir, store);
    const fsManager = new VaultFsManager(benchDir, store, indexer);
    const snapshotManager = new VaultSnapshotManager(benchDir, store, fsManager, indexer);

    // =========================================================================
    // Benchmark 1: Vault Indexing & PageRank Graph Convergence
    // =========================================================================
    {
      const tStart = performance.now();
      let passed = false;
      let error: string | undefined;

      try {
        // Create sample notes with star topology centered on MOC
        fs.mkdirSync(path.join(benchDir, "Inbox"), { recursive: true });
        fs.mkdirSync(path.join(benchDir, "Topics"), { recursive: true });

        fs.writeFileSync(
          path.join(benchDir, "Topics", "Artificial Intelligence.md"),
          `# Artificial Intelligence\n\nCentral hub for #ai and #cs.\n- [[Deep Learning]]\n- [[Neural Networks]]\n- [[Cognitive Architectures]]`
        );
        fs.writeFileSync(
          path.join(benchDir, "Topics", "Deep Learning.md"),
          `# Deep Learning\n\nSubset of [[Artificial Intelligence]]. Uses [[Neural Networks]].`
        );
        fs.writeFileSync(
          path.join(benchDir, "Topics", "Neural Networks.md"),
          `# Neural Networks\n\nCore mechanism of [[Deep Learning]] and [[Artificial Intelligence]].`
        );
        fs.writeFileSync(
          path.join(benchDir, "Topics", "Cognitive Architectures.md"),
          `# Cognitive Architectures\n\nIntegrates [[Artificial Intelligence]] and [[Second Brain Systems]].`
        );
        fs.writeFileSync(
          path.join(benchDir, "Topics", "Second Brain Systems.md"),
          `# Second Brain Systems\n\nPersonal knowledge base linking to [[Artificial Intelligence]].`
        );

        const res = indexer.indexAll(true);
        const searchHits = store.searchNotes("Artificial Intelligence", 5);
        const pr = store.computePageRank();
        const hubScore = pr.get("Topics/Artificial Intelligence.md") ?? 0;

        if (res.total >= 5 && searchHits.length > 0) {
          // Central note is the star hub, should have maximum normalized PageRank
          passed = hubScore >= 0.8;
          if (!passed) error = `PageRank ${hubScore} lower than expected threshold (0.8).`;
        } else {
          error = `Indexed ${res.total} notes; search hits: ${searchHits.length}`;
        }
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : String(err);
      }

      tasks.push({
        id: 1,
        name: "Vault Indexing & PageRank Graph Convergence",
        description: "Evaluates multi-note indexing, graph topology link resolution, and PageRank scoring.",
        passed,
        durationMs: Math.round(performance.now() - tStart),
        steps: 1,
        error,
      });
    }

    // =========================================================================
    // Benchmark 2: MOC & Topic Cluster Graph Integrity
    // =========================================================================
    {
      const tStart = performance.now();
      let passed = false;
      let error: string | undefined;

      try {
        const aiPath = "Topics/Artificial Intelligence.md";
        const outgoing = store.getOutgoingLinks(aiPath);
        const backlinks = store.getBacklinks(aiPath);
        const tags = store.getTagsForNote(aiPath);

        const hasExpectedOutgoing = outgoing.length >= 3;
        const hasExpectedBacklinks = backlinks.length >= 3;
        const hasTags = tags.includes("ai");

        passed = hasExpectedOutgoing && hasExpectedBacklinks && hasTags;
        if (!passed) {
          error = `Expected >=3 outgoing (got ${outgoing.length}), >=3 backlinks (got ${backlinks.length}), tag #ai (got ${tags.join(",")})`;
        }
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : String(err);
      }

      tasks.push({
        id: 2,
        name: "MOC & Topic Cluster Graph Integrity",
        description: "Validates bidirectional [[wiki-link]] graph traversal, backlinks, and tag indexing.",
        passed,
        durationMs: Math.round(performance.now() - tStart),
        steps: 1,
        error,
      });
    }

    // =========================================================================
    // Benchmark 3: Broken Wiki-Link Diagnostics & Fuzzy Healing
    // =========================================================================
    {
      const tStart = performance.now();
      let passed = false;
      let error: string | undefined;

      try {
        const testBrokenPath = path.join(benchDir, "Inbox", "Research Notes.md");
        fs.writeFileSync(
          testBrokenPath,
          `# Research Notes\n\nLooking into [[Artifical Inteligence]] and [[Deep-Learnng]] for [[Secnd Brain Systems]].`
        );

        const diag = runAutomatedDiagnostics(benchDir, ["Inbox/Research Notes.md"]);
        const errorText = diag.errors.join("\n");

        // Verify all 3 broken links are caught and suggestions match
        const foundAi = errorText.includes("Artificial Intelligence");
        const foundDl = errorText.includes("Deep Learning");
        const foundSb = errorText.includes("Second Brain Systems");

        passed = !diag.ok && foundAi && foundDl && foundSb;
        if (!passed) {
          error = `Diagnostics failed to suggest all matches. Diag errors:\n${errorText}`;
        }
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : String(err);
      }

      tasks.push({
        id: 3,
        name: "Broken Wiki-Link Diagnostics & Fuzzy Healing",
        description: "Tests Levenshtein distance fuzzy repair engine for broken wiki-links.",
        passed,
        durationMs: Math.round(performance.now() - tStart),
        steps: 2,
        error,
      });
    }

    // =========================================================================
    // Benchmark 4: Task List Checkbox Integrity & Store Normalization
    // =========================================================================
    {
      const tStart = performance.now();
      let passed = false;
      let error: string | undefined;

      try {
        // Verify malformed task detection
        const taskNotePath = path.join(benchDir, "Inbox", "Tasks.md");
        fs.writeFileSync(
          taskNotePath,
          `# Action Items\n\n-[ ] Malformed checkbox A\n-[] Malformed checkbox B\n- [x] Valid done task\n- [ ] Valid open task\n`
        );
        const diag = runAutomatedDiagnostics(benchDir, ["Inbox/Tasks.md"]);
        const caughtMalformed = diag.errors.some((e) => e.includes("task checkbox"));

        // Verify store task operations
        const session = store.createSession({ mode: "plan", provider: "gemini", model: "gemini-3.8-flash" });
        const task1 = store.addTask({ title: "Read literature", sessionId: session.id, filePath: "Inbox/Tasks.md" });
        const task2 = store.addTask({ title: "Implement graph", sessionId: session.id });
        store.toggleTask(task1.id, true);

        const openTasks = store.listTasks(false);
        const allTasks = store.listTasks(true);

        passed =
          caughtMalformed &&
          openTasks.some((t) => t.id === task2.id) &&
          !openTasks.some((t) => t.id === task1.id) &&
          allTasks.length >= 2;

        if (!passed) {
          error = `Task integrity checks failed (caughtMalformed=${caughtMalformed}, openTasks=${openTasks.length})`;
        }
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : String(err);
      }

      tasks.push({
        id: 4,
        name: "Task List Checkbox & Store Normalization",
        description: "Validates markdown checkbox syntax linting and SQLite task lifecycle tracking.",
        passed,
        durationMs: Math.round(performance.now() - tStart),
        steps: 1,
        error,
      });
    }

    // =========================================================================
    // Benchmark 5: CoW Workspace Snapshot & Rollback Harness
    // =========================================================================
    {
      const tStart = performance.now();
      let passed = false;
      let error: string | undefined;

      try {
        const baselineFile = "Topics/Deep Learning.md";
        const originalContent = fs.readFileSync(path.join(benchDir, baselineFile), "utf-8");

        const session = store.createSession({ mode: "builder", provider: "gemini", model: "gemini-3.8-flash" });
        const ctx = snapshotManager.beginTurn(session.id, "Refactor Deep Learning note", 1);

        // Record pre-mutation and apply destructive edits
        snapshotManager.recordBeforeMutation(ctx, baselineFile, "modified");
        fs.writeFileSync(path.join(benchDir, baselineFile), "CORRUPTED DATA DESTROYED");

        // Record rogue file creation
        const rogueFile = "Inbox/Rogue Temp.md";
        snapshotManager.recordBeforeMutation(ctx, rogueFile, "created");
        fs.writeFileSync(path.join(benchDir, rogueFile), "# Rogue File");

        // Commit snapshot
        const snap = snapshotManager.commitTurn(ctx);
        if (!snap) {
          throw new Error("Failed to commit snapshot");
        }

        // Execute rollback
        const rollbackRes = snapshotManager.rollback(snap.id);
        const restoredContent = fs.readFileSync(path.join(benchDir, baselineFile), "utf-8");
        const rogueExists = fs.existsSync(path.join(benchDir, rogueFile));

        passed =
          rollbackRes.success &&
          restoredContent === originalContent &&
          !rogueExists &&
          rollbackRes.restoredFiles.includes(baselineFile) &&
          rollbackRes.deletedFiles.includes(rogueFile);

        if (!passed) {
          error = `Rollback mismatch: success=${rollbackRes.success}, restored=${restoredContent === originalContent}, rogueExists=${rogueExists}`;
        }
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : String(err);
      }

      tasks.push({
        id: 5,
        name: "CoW Snapshot & Zero-Loss Rollback Harness",
        description: "Verifies pre-mutation file backups, byte-fidelity restoration, and rogue file cleanup.",
        passed,
        durationMs: Math.round(performance.now() - tStart),
        steps: 3,
        error,
      });
    }

    store.close();
  } finally {
    if (!isCustom) {
      cleanupWorkspace(benchDir);
    }
  }

  const totalDurationMs = Math.round(performance.now() - startAll);
  const passedCount = tasks.filter((t) => t.passed).length;
  const totalCount = tasks.length;
  const successRate = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

  return {
    tasks,
    totalDurationMs,
    passedCount,
    totalCount,
    successRate,
  };
}

/**
 * Renders a clean terminal scorecard table from a BenchmarkReport.
 */
export function formatBenchmarkScorecard(report: BenchmarkReport): string {
  const line = "─".repeat(80);
  const header = `✦ Oro Second Brain Autonomous Benchmark Suite`;
  const subHeader = `Tasks: ${report.passedCount}/${report.totalCount} Passed (${report.successRate}%) | Total Time: ${report.totalDurationMs}ms`;

  const rows = report.tasks.map((t) => {
    const statusCol = t.passed ? "✔ PASS" : "✖ FAIL";
    const nameCol = t.name.length > 44 ? t.name.slice(0, 41) + "..." : t.name.padEnd(44);
    const timeCol = `${t.durationMs}ms`.padStart(8);
    const stepsCol = `${t.steps} step${t.steps === 1 ? "" : "s"}`.padStart(8);
    return `[${t.id}] ${nameCol} ${statusCol}  ${stepsCol}  ${timeCol}`;
  });

  const failureDetails = report.tasks
    .filter((t) => !t.passed && t.error)
    .map((t) => `  ✖ [Task ${t.id}] ${t.name}: ${t.error}`)
    .join("\n");

  return [
    "",
    line,
    header,
    subHeader,
    line,
    ...rows,
    line,
    failureDetails ? `Failures:\n${failureDetails}\n${line}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
