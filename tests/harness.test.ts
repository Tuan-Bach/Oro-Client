import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ToolLoopBreaker,
  executeWithTimeout,
  TurnBudgetCircuitBreaker,
  canonicalizeArgs,
  hashToolCall,
} from "../src/agent/circuit-breaker.js";
import { runSecondBrainBenchmarks, formatBenchmarkScorecard } from "../src/bench.js";

describe("Agent Harness, Circuit Breakers & Benchmarks", () => {
  it("ToolLoopBreaker intercepts infinite loops after 3 identical tool calls", () => {
    const breaker = new ToolLoopBreaker({ maxConsecutiveIdentical: 3, windowSize: 8 });

    const call1 = breaker.record("edit_file", { path: "note.md", target: "foo", replacement: "bar" });
    assert.equal(call1.allowed, true);
    assert.equal(call1.repetitions, 1);

    const call2 = breaker.record("edit_file", { path: "note.md", target: "foo", replacement: "bar" });
    assert.equal(call2.allowed, true);
    assert.equal(call2.repetitions, 2);

    // Third identical call must trip the breaker
    const call3 = breaker.record("edit_file", { path: "note.md", target: "foo", replacement: "bar" });
    assert.equal(call3.allowed, false);
    assert.equal(call3.repetitions, 3);
    assert.ok(call3.reason?.includes("Loop Breaker Tripped"));
    assert.ok(call3.reason?.includes("edit_file"));

    // Calling with different parameters should be permitted
    const call4 = breaker.record("edit_file", { path: "note.md", target: "baz", replacement: "qux" });
    assert.equal(call4.allowed, true);

    // Resetting clears history
    breaker.reset();
    assert.equal(breaker.historySize, 0);
    const callAfterReset = breaker.record("edit_file", { path: "note.md", target: "foo", replacement: "bar" });
    assert.equal(callAfterReset.allowed, true);
    assert.equal(callAfterReset.repetitions, 1);
  });

  it("canonicalizeArgs & hashToolCall produce stable hashes regardless of object key ordering", () => {
    const hash1 = hashToolCall("write_file", { path: "Inbox/A.md", content: "Hello", mode: "overwrite" });
    const hash2 = hashToolCall("write_file", { mode: "overwrite", content: "Hello", path: "Inbox/A.md" });
    assert.equal(hash1, hash2, "Identical arguments with reversed key order must produce identical hash");

    const hashDiff = hashToolCall("write_file", { path: "Inbox/B.md", content: "Hello", mode: "overwrite" });
    assert.notEqual(hash1, hashDiff, "Different arguments must produce different hash");
  });

  it("executeWithTimeout handles fast completion and aborts hung tools without throwing", async () => {
    // 1. Fast tool succeeds normally
    const fastResult = await executeWithTimeout(
      async () => ({ ok: true, output: "Fast output", summary: "Done" }),
      { timeoutMs: 200, toolName: "fast_tool" }
    );
    assert.equal(fastResult.ok, true);
    assert.equal(fastResult.output, "Fast output");

    // 2. Slow tool times out cleanly and returns error result
    const slowResult = await executeWithTimeout(
      async (signal) => {
        return new Promise<{ ok: boolean; output: string; summary: string }>((resolve) => {
          const timer = setTimeout(() => {
            resolve({ ok: true, output: "Should not happen", summary: "Late" });
          }, 300);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
          });
        });
      },
      { timeoutMs: 50, toolName: "hung_tool" }
    );
    assert.equal(slowResult.ok, false);
    assert.ok(slowResult.output.includes('Tool "hung_tool" timed out after 50ms'));
    assert.ok(slowResult.summary.includes("hung_tool timed out"));
  });

  it("TurnBudgetCircuitBreaker halts execution when step, tool call, or token limits are exceeded", () => {
    const budget = new TurnBudgetCircuitBreaker({ maxSteps: 3, maxToolCalls: 5, maxTotalChars: 1000 });

    const step1 = budget.recordStep(200, 2);
    assert.equal(step1.exceeded, false);
    assert.equal(budget.totalSteps, 1);
    assert.equal(budget.totalToolCalls, 2);

    const step2 = budget.recordStep(300, 2);
    assert.equal(step2.exceeded, false);
    assert.equal(budget.totalSteps, 2);
    assert.equal(budget.totalToolCalls, 4);

    // Exceeding tool calls
    const step3 = budget.recordStep(100, 2);
    assert.equal(step3.exceeded, true);
    assert.ok(step3.reason?.includes("tool call limit"));

    budget.reset();
    assert.equal(budget.totalSteps, 0);

    // Exceeding steps
    budget.recordStep(10, 0);
    budget.recordStep(10, 0);
    budget.recordStep(10, 0);
    const stepExceeded = budget.recordStep(10, 0);
    assert.equal(stepExceeded.exceeded, true);
    assert.ok(stepExceeded.reason?.includes("step limit"));
  });

  it("Automated Benchmark Suite runs 5 Second Brain benchmarks with 100% pass rate", async () => {
    const report = await runSecondBrainBenchmarks();

    assert.equal(report.totalCount, 5, "Must execute exactly 5 benchmark tasks");
    assert.equal(report.passedCount, 5, `Expected all 5 tasks to pass, passed: ${report.passedCount}/${report.totalCount}`);
    assert.equal(report.successRate, 100);

    // Verify task IDs and names
    assert.equal(report.tasks[0]?.id, 1);
    assert.equal(report.tasks[0]?.name, "Vault Indexing & PageRank Graph Convergence");
    assert.equal(report.tasks[1]?.id, 2);
    assert.equal(report.tasks[1]?.name, "MOC & Topic Cluster Graph Integrity");
    assert.equal(report.tasks[2]?.id, 3);
    assert.equal(report.tasks[2]?.name, "Broken Wiki-Link Diagnostics & Fuzzy Healing");
    assert.equal(report.tasks[3]?.id, 4);
    assert.equal(report.tasks[3]?.name, "Task List Checkbox & Store Normalization");
    assert.equal(report.tasks[4]?.id, 5);
    assert.equal(report.tasks[4]?.name, "CoW Snapshot & Zero-Loss Rollback Harness");

    // Verify scorecard rendering
    const card = formatBenchmarkScorecard(report);
    assert.ok(card.includes("Autonomous Benchmark Suite"));
    assert.ok(card.includes("5/5 Passed (100%)"));
    assert.ok(card.includes("PASS"));
  });
});
